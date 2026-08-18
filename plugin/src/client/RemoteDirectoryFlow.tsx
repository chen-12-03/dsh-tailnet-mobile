/**
 * The phone-side directory-flow occupant. The stock occupant
 * (`dsh-client-ui-directory-picker-native`) calls `host.pickDirectory`, which
 * the connection plugin pins to loopback — a phone arriving via Tailscale
 * Serve can never satisfy that (HTTP 403), and the native dialog would open on
 * the HOST machine anyway. This occupant replaces that interaction on remote
 * pages: it lists the workspaces ALREADY registered on the host
 * (`ctx.workspaces.list`) and hands the picked workspace's own `path` to the
 * owner's `onPicked`. The owner's `adoptDirectory → createWorkspace({ path })`
 * is idempotent for an existing path, so it resolves to that same workspace and
 * `onPick(id)` fires — the picker closes and the workspace's session opens,
 * with no host dialog and no new folder. Pure presentation; list + outcomes
 * arrive through props from the owner conversation.
 *
 * The workspace list may not have loaded yet when the flow opens (the baseline
 * arrives on connect), so the occupant re-arms a `refresh()` whenever the list
 * is not `ready`, and distinguishes "still loading" (`state==='loading'` /
 * `phase==='pending'`) from "genuinely empty" (`phase==='ready'` and no items)
 * instead of showing the empty message during the load window.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { IWorkspaces, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from './remote.module.css'

/** Refresh capability (the concrete workspaces service, not the `IWorkspaces` face). */
type RefreshableWorkspaces = IWorkspaces & { refresh(): Promise<unknown> }

/** Full occupant props: owner conversation + the read face of the workspaces service. */
export interface RemoteDirectoryFlowProps extends DirectoryFlowOwnerProps {
  /** Wire-facing workspaces service; the registered list is read from it. */
  workspaces: IWorkspaces
  /** Re-pull the workspace baseline; supplied by the fork plugin's inject. */
  refresh?: () => Promise<unknown>
  /** Locale seat bound to the `remote` namespace. */
  t: TranslateNS<'remote'>
}

/**
 * Render the remote workspace picker.
 * @param props - owner conversation + workspaces read face.
 * @returns a fixed overlay listing registered workspaces, or nothing while closed.
 */
export function RemoteDirectoryFlow({ open, busy, onPicked, onCancel, onError, workspaces, refresh, t }: RemoteDirectoryFlowProps) {
  const state = useSyncExternalStore(
    workspaces.list.subscribe,
    workspaces.list.getSnapshot,
  )
  // One outcome per open: the owner adopts the first pick and withdraws `open`;
  // re-renders while `busy` must never launch a second `onPicked`. Re-armed each
  // time the owner closes the flow. `onError` is retained for the full owner
  // contract; list failures surface inline (the owner's folder-error dialog is
  // worded for host-picker failures).
  const outcome = useRef<RemoteDirectoryFlowProps>({ open, busy, onPicked, onCancel, onError, workspaces, refresh, t })
  outcome.current = { open, busy, onPicked, onCancel, onError, workspaces, refresh, t }
  const committed = useRef(false)
  const armed = useRef(false)
  useEffect(() => {
    if (!open) {
      committed.current = false
      armed.current = false
      return
    }
    if (armed.current) return
    armed.current = true
    const snapshot = workspaces.list.getSnapshot()
    // Ensure the list is present before offering it; the baseline may not have
    // landed yet (connect-time pull is async). `refresh` is idempotent (reuses
    // an in-flight pull) and cheap.
    if (snapshot.phase !== 'ready' || snapshot.items.length === 0) {
      try {
        void refresh?.()
      } catch {
        // Surface via the list state rather than crashing the occupant.
      }
    }
  }, [open, workspaces, refresh])

  // R10: while the flow stays open and the list is still not ready, re-pull the
  // baseline every few seconds. Covers a refresh racing the connection handshake
  // (connect-time pull may run before the streams are up) or a transient RPC
  // failure — the picker heals without requiring the user to close and reopen.
  useEffect(() => {
    if (!open) return () => {}
    const timer = window.setInterval(() => {
      const snapshot = workspaces.list.getSnapshot()
      if (snapshot.phase === 'ready' && snapshot.items.length > 0) return
      try {
        void refresh?.()
      } catch {
        // Surface via the list state rather than crashing the occupant.
      }
    }, 4_000)
    return () => { window.clearInterval(timer) }
  }, [open, workspaces, refresh])

  if (!open) return null

  const commitPick = (workspace: WorkspaceView): void => {
    if (committed.current || busy) return
    committed.current = true
    outcome.current.onPicked(workspace.path)
  }

  const { items, state: listState, phase } = state
  const loading = listState === 'loading' || phase === 'pending'
  const failed = listState === 'error'
  const ready = phase === 'ready'
  const body = items.length > 0
    ? (
      <ul className={css.flowList}>
        {items.map(workspace => (
          <li key={workspace.workspaceId}>
            <button
              type="button"
              className={css.flowItem}
              disabled={busy}
              onClick={() => commitPick(workspace)}
            >
              <span className={css.flowItemTitle}>{workspace.title}</span>
              <span className={css.flowItemPath}>{workspace.path}</span>
            </button>
          </li>
        ))}
      </ul>
    )
    : loading
      ? <p className={css.flowHint} role="status">{t('flow.loading')}</p>
      : failed
        ? (
          <p className={css.flowError} role="alert">
            {t('flow.error')}
            {' '}
            <button
              type="button"
              className={css.flowRetry}
              onClick={() => { void refresh?.() }}
            >
              {t('flow.retry')}
            </button>
          </p>
        )
        : ready
          ? <p className={css.flowHint}>{t('flow.empty')}</p>
          : <p className={css.flowHint} role="status">{t('flow.loading')}</p>

  return createPortal(
    <div className={css.flowOverlay} role="dialog" aria-modal="true" aria-label={t('flow.title')}>
      <div className={css.mask} onClick={onCancel} />
      <div className={css.flowPanel}>
        <div className={css.flowHeader}>
          <div className={css.flowHeading}>
            <h2 className={css.flowTitle}>{t('flow.title')}</h2>
            <p className={css.flowSubtitle}>{t('flow.subtitle')}</p>
          </div>
          <button
            type="button"
            className={css.flowClose}
            aria-label={t('flow.close')}
            onClick={onCancel}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        {body}
        {busy && items.length > 0 && <p className={css.flowHint} role="status">{t('flow.opening')}</p>}
      </div>
    </div>,
    document.body,
  )
}
