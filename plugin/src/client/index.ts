/**
 * Mobile remote control — browser half. Registers the `remote` dictionaries,
 * the sidebar-foot entry (phone trigger + pairing panel) into the
 * ui-sidebar-declared `sidebar.remote` seat, and runs the phone-side boot
 * flow (pair accept + workspace deep-link + presence heartbeats) plus the
 * one-time failed-pair notice. Export discipline: packages/client/AGENTS.md
 * — the /client surface carries only what cordis loading needs plus types.
 */
// Install the browser-compat polyfills (AbortSignal.timeout / .any, …) at
// module load — BEFORE any plugin apply() runs the dsh connection handshake,
// so core's fetch carrier never throws on this phone's older browser.
import { ensureCompatPolyfills } from './compat-polyfill.ts'
ensureCompatPolyfills()
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { ClientContext, SettingsScope, SettingsScopeSpec } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale) and the
// ui-sidebar SlotMap merge (the 'sidebar.remote' hole).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings-surface SlotMap merge (the 'settings.section'
// entry) and the ctx.settingsScope Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the ui-workspace SlotMap merge — the two directory-flow
// holes (`sidebar.workspaces.directoryFlow` /
// `conversation.hero.workspace.directoryFlow`) this surface overrides.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { FooterRemoteEntry } from './FooterRemoteEntry.tsx'
import { RemoteEntry } from './RemoteEntry.tsx'
import { RemoteDirectoryFlow } from './RemoteDirectoryFlow.tsx'
import { PairFailedNotice } from './PairFailedNotice.tsx'
import { RemoteSettingsCard, RemoteSettingsCardController, type RemoteSettings } from './RemoteSettingsCard.tsx'
import { en, zh, type RemoteKey } from './locales.ts'
import { PAIR_FAILED_MARKER, runPairBootFlow } from './deep-link.ts'
import { sendHeartbeat } from './pair-api.ts'
import { FlowDiagToast, flowDiag } from './FlowDiagToast.tsx'

export type { RemoteEntryProps } from './RemoteEntry.tsx'
export type { PanelState, RemotePanelProps } from './RemotePanel.tsx'
export type { PairFailedNoticeProps } from './PairFailedNotice.tsx'
export type { RemoteKey } from './locales.ts'
export type { RemoteSettingsCardFace, RemoteSettingsCardState } from './RemoteSettingsCard.tsx'
export type { UpdateEntryProps } from './UpdateEntry.tsx'
export type { UpdatePanelProps, UpdateView } from './UpdatePanel.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Mobile remote-control surface copy. */
    remote: RemoteKey
  }

  interface SlotMap {
    /**
     * The sidebar foot seat beside the settings trigger, declared by the
     * sidebar shell on deployments that carry the feature seat; the shell
     * passes only its column display state.
     */
    'sidebar.remote': { kind: 'single'; scope: 'root'; owner: SidebarRemoteOwnerProps }
    /**
     * The child slot the Web UI plugin group declares; this card registers
     * into the group instead of the top-level `settings.plugin.item` list.
     * Spelled here with the same shape so this package can register without
     * depending on the sibling UI package.
     */
    'web-ui.plugin.item': { kind: 'list'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
  }
}

/** Owner share of the sidebar remote-control seat: the column display state the trigger renders against. */
export interface SidebarRemoteOwnerProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
}

/** Owner share of a plugin card (the section supplies nothing). */
export interface SettingsPluginItemOwnerProps {
  /** Marker field: card owner props are intentionally empty. */
  children?: never
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Optional rc.6 compatibility binder provided by dsh-web-ui-settings;
     * absent when that group plugin is not installed, so callers fall back to
     * the official settings scope.
     */
    webUiSettings?: { bind<S>(spec: SettingsScopeSpec<S>): SettingsScope<S> }
  }
}


/** Dictionary namespace owned by this plugin. */
const NS = 'remote'

/** Settings namespace the remote-control card edits (the Host plugin registers it). */
const REMOTE_WEB_UI_NS = 'remote-web-ui'

/** Heartbeat cadence from a paired phone (presence + revocation liveness). */
const HEARTBEAT_INTERVAL_MS = 10_000

/** Services required by this plugin. */
export const inject = ['slots', 'locale', 'connection', 'settingsScope', 'remote', 'workspaces']

/**
 * Register the remote-control surface.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // Belt-and-braces: re-install the polyfills at apply time (idempotent) in
  // case this module's top-level ran after the connection loop already threw
  // — the loop retries with 250ms+ backoff, so this lands before the retry.
  ensureCompatPolyfills()
  console.info('[dsh-mobile] fork client apply() rev=R11')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'remote-web-ui: dictionaries')

  const t = ctx.locale.bind(NS)
  const binder = ctx.get('webUiSettings') ?? ctx.settingsScope
  const settingsScope = binder.bind<RemoteSettings>({ namespace: REMOTE_WEB_UI_NS })
  const enabled = (): boolean => {
    const snapshot = settingsScope.getSnapshot()
    return snapshot.status === 'ready'
      ? snapshot.value?.enabled ?? true
      : snapshot.status === 'unavailable'
  }
  const connectionOf = (): ConnectionHandle | undefined => {
    try {
      return ctx.get('connection') as ConnectionHandle | undefined
    } catch {
      return undefined
    }
  }

  // Sidebar foot entry: the shell declares 'sidebar.remote' in unconstrained
  // order, so registration is declaration-aware — slots.inject waits on the
  // declaration, removes the contribution when it collapses, and re-runs
  // after a redeclaration. The entry follows the plugin's enabled setting:
  // toggling it off removes the trigger, toggling it back on re-registers it.
  ctx.slots.inject('sidebar.remote', () => {
    let disposeEntry: (() => void) | undefined
    const syncEntry = (): void => {
      if (enabled() && disposeEntry === undefined) {
        disposeEntry = ctx.slots.register({ name: 'sidebar.remote', locale: NS }, RemoteEntry)
      } else if (!enabled() && disposeEntry !== undefined) {
        disposeEntry()
        disposeEntry = undefined
      }
    }
    const unsubscribe = settingsScope.subscribe(syncEntry)
    syncEntry()
    return () => {
      unsubscribe()
      disposeEntry?.()
    }
  })

  // Current shells declare `sidebar.footer.action` instead of the legacy
  // `sidebar.remote` seat; this fallback registers the same entry there when
  // the legacy seat never arrives (declaration-aware: only one of the two
  // injects ever fires, so the trigger can never render twice).
  ctx.slots.inject('sidebar.footer.action', () => {
    let disposeEntry: (() => void) | undefined
    const syncEntry = (): void => {
      if (enabled() && disposeEntry === undefined) {
        disposeEntry = ctx.slots.register({ name: 'sidebar.footer.action', id: 'remote-web-ui', locale: NS }, FooterRemoteEntry)
      } else if (!enabled() && disposeEntry !== undefined) {
        disposeEntry()
        disposeEntry = undefined
      }
    }
    const unsubscribe = settingsScope.subscribe(syncEntry)
    syncEntry()
    return () => {
      unsubscribe()
      disposeEntry?.()
    }
  })

  // Plugin configuration card: one staged form over the `remote-web-ui`
  // settings namespace, contributed to the Web UI plugin group.
  const remoteSettings = new RemoteSettingsCardController(settingsScope)
  ctx.slots.inject('web-ui.plugin.item', () => ctx.slots.register({
    name: 'web-ui.plugin.item',
    id: 'remote-web-ui',
    order: 90,
    locale: NS,
    inject: () => remoteSettings.inject(),
  }, RemoteSettingsCard))

  // Remote directory-flow override. The stock occupant
  // (`dsh-client-ui-directory-picker-native`) drives `host.pickDirectory`, a
  // privileged method pinned to loopback — a phone arriving via Tailscale Serve
  // gets HTTP 403, and the native dialog would open on the HOST machine anyway.
  // This surface replaces both directory-flow holes (the sidebar "+" and the
  // conversation hero picker) on remote pages with a picker over the workspaces
  // ALREADY registered on the host. Handing the picked workspace's own `path`
  // to the owner's `onPicked` is safe: `workspace.create` is not loopback-gated
  // and is idempotent for an existing path, so the owner's adoption resolves to
  // the same workspace and `onPick(id)` fires with no host dialog. Registered at
  // priority -1 (lower wins) only while the plugin is enabled and the page is
  // served off loopback; the desktop keeps the stock native picker untouched.
  //
  // Both holes are registered through ONE nested inject that mirrors the stock
  // picker's own registration shape (outer inject on the conversation hole,
  // inner inject on the sidebar hole, generator yields the two registrations) —
  // the proven stock structure, so no ordering/declaration difference can bite.
  // Concrete workspaces service carries the wire-pump `refresh` the flow needs
  // to re-pull the baseline when the list has not landed yet.
  type RefreshableWorkspaces = typeof ctx.workspaces & { refresh(): Promise<unknown> }
  const registerRemoteDirectoryFlow = (name: 'conversation.hero.workspace.directoryFlow' | 'sidebar.workspaces.directoryFlow'): (() => void) => {
    const connection = connectionOf()
    const loopback = connection?.isLoopback ?? true
    if (loopback) {
      console.info('[dsh-mobile] flow inject fired, loopback — skipping override:', name)
      return () => {}
    }
    console.info('[dsh-mobile] flow inject fired, registering:', name)
    // `refresh` lives on the concrete workspaces service, not the `IWorkspaces`
    // face — the flow re-pulls the baseline through it when the list is not ready.
    const injected = () => ({
      workspaces: ctx.workspaces,
      refresh: () => (ctx.workspaces as RefreshableWorkspaces).refresh(),
    })
    let disposeEntry: (() => void) | undefined
    const syncEntry = (): void => {
      const on = enabled()
      if (on && disposeEntry === undefined) {
        try {
          disposeEntry = ctx.slots.register({ name, priority: -1, locale: NS, inject: injected }, RemoteDirectoryFlow)
          flowDiag[name] = 'registered'
          console.info('[dsh-mobile] flow entry REGISTERED at priority -1:', name)
        } catch (error) {
          flowDiag[name] = error instanceof Error ? error.message : String(error)
          console.error('[dsh-mobile] flow register FAILED:', name, error)
        }
      } else if (!on && disposeEntry !== undefined) {
        disposeEntry()
        disposeEntry = undefined
        flowDiag[name] = 'disabled'
      } else if (!on) {
        flowDiag[name] = `waiting(enabled=${on})`
      }
    }
    const unsubscribe = settingsScope.subscribe(syncEntry)
    syncEntry()
    return () => {
      unsubscribe()
      disposeEntry?.()
    }
  }
  ctx.slots.inject('conversation.hero.workspace.directoryFlow', () => ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
    yield registerRemoteDirectoryFlow('conversation.hero.workspace.directoryFlow')
    yield registerRemoteDirectoryFlow('sidebar.workspaces.directoryFlow')
  }))

  // R10 diagnostics: capture any directory-flow entry crash so the toast can say
  // WHY the native picker took over (a render crash abdicates the cell to the
  // stock occupant → host.pickDirectory → HTTP 403).
  ctx.effect(() => ctx.slots.onEntryError((key, entry, error) => {
    if (key === 'sidebar.workspaces.directoryFlow' || key === 'conversation.hero.workspace.directoryFlow') {
      flowDiag[key] = 'crashed: ' + (error instanceof Error ? error.message : String(error))
      console.error('[dsh-mobile] flow entry CRASHED (slot abdicates to native picker):', key, error)
    }
  }), 'remote-web-ui: flow crash diagnostics')

  // R10 diagnostics: mirror the live workspace-list state (state/phase/count/
  // error) plus a short transition log into the toast, so the phone test can
  // tell "connection never connected" (list never leaves idle/pending, no
  // transitions) apart from "refresh fired but failed" (a loading → error
  // transition with the RPC code in the log).
  let lastListKey = ''
  const syncListDiag = (): void => {
    const snapshot = ctx.workspaces.list.getSnapshot()
    const error = snapshot.error
    const key = `${snapshot.state}/${snapshot.phase} items=${snapshot.items.length}`
    const err = error !== null
      ? ` err=${error.code}:${error.message}`
      : ''
    flowDiag['list'] = `${key}${err}`
    if (key !== lastListKey) {
      const stamp = new Date().toLocaleTimeString()
      flowDiag['log'] = `${key}@${stamp} ${flowDiag['log'] ?? ''}`.slice(0, 160)
      lastListKey = key
    }
  }
  // Manual refresh from the toast (idempotent: reuses an in-flight pull).
  flowDiag['refresh'] = () => {
    void (ctx.workspaces as RefreshableWorkspaces).refresh()
  }
  ctx.effect(() => {
    syncListDiag()
    const unsubscribe = ctx.workspaces.list.subscribe(syncListDiag)
    return () => { unsubscribe() }
  }, 'remote-web-ui: workspaces list diagnostics')

  // R10 diagnostics: track whether the dsh connection reached "connected"
  // (hostDescription appears only after a generation's handshake succeeds).
  // A phone whose connection never establishes shows 未连接 here — the root
  // cause then lives in the transport, not in the workspace picker.
  ctx.effect(() => {
    const connection = connectionOf()
    const hostDescription = connection?.hostDescription
    if (hostDescription === undefined) {
      flowDiag['conn'] = 'connection service absent'
      return () => {}
    }
    const syncConn = (): void => {
      flowDiag['conn'] = hostDescription.getSnapshot() !== undefined ? '已连接' : '未连接'
    }
    syncConn()
    const unsubscribe = hostDescription.subscribe(syncConn)
    return () => { unsubscribe() }
  }, 'remote-web-ui: connection diagnostics')

  // R8 diagnostics: a self-dismissing toast on remote pages reporting the live
  // override registration state. Its mere presence proves the new bundle ran.
  ctx.effect(() => {
    if (connectionOf()?.isLoopback ?? true) return () => {}
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    const root = createRoot(mount)
    root.render(createElement(FlowDiagToast))
    return () => {
      root.unmount()
      mount.remove()
    }
  }, 'remote-web-ui: flow diagnostics toast')

  // Phone-side boot flow + heartbeats. Loopback pages (the desktop) never
  // heartbeat; the server ignores unpaired heartbeats anyway. Both run only
  // while the plugin is enabled.
  let disposeRuntime: (() => void) | undefined
  const syncRuntime = (): void => {
    if (enabled() && disposeRuntime === undefined) {
      disposeRuntime = ctx.effect(() => {
        const connection = ctx.get('connection') as ConnectionHandle | undefined
        const loopback = connection?.isLoopback ?? true
        runPairBootFlow(ctx, window.location.search)
        if (loopback) return () => {}
        const timer = window.setInterval(() => { void sendHeartbeat().catch(() => {}) }, HEARTBEAT_INTERVAL_MS)
        return () => { window.clearInterval(timer) }
      }, 'remote-web-ui: pair flow + heartbeats')
    } else if (!enabled() && disposeRuntime !== undefined) {
      disposeRuntime()
      disposeRuntime = undefined
    }
  }
  settingsScope.subscribe(syncRuntime)
  syncRuntime()

  // One-time failed-pair toast. The accept result lands asynchronously, so
  // the marker check is deferred past the accept round trip.
  ctx.effect(() => {
    const timer = window.setTimeout(() => {
      if (sessionStorage.getItem(PAIR_FAILED_MARKER) === null) return
      sessionStorage.removeItem(PAIR_FAILED_MARKER)
      const mount = document.createElement('div')
      document.body.appendChild(mount)
      const root = createRoot(mount)
      root.render(createElement(PairFailedNotice, { t }))
      // The toast owns its dismissal; the root lives for the page lifetime.
      void root
    }, 1500)
    return () => { window.clearTimeout(timer) }
  }, 'remote-web-ui: failed-pair notice')
}
