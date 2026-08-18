/**
 * Landing level: the workspace roster. The mobile surface opens straight
 * here — no new-session homepage — and every workspace row is a thin
 * fetch from workspace.list (the roster is small; sessions are not loaded
 * until a workspace is opened).
 */

import { useEffect, useState } from 'react'
import type { WorkspaceView as WorkspaceRow } from '@deepseek-ai/dsh-host-apiproxy/api/workspace'
import { listWorkspaces } from '../api.ts'
import { errorText } from './App.tsx'
import { ThemeToggle } from '../theme-toggle.tsx'

/** Props for the workspace roster. */
export interface WorkspaceViewProps {
  /** Workspace carried by the pairing link; opened after the roster loads. */
  initialWorkspaceId?: string
  /** Open one workspace's session list. */
  onPick(workspace: WorkspaceRow): void
}

/**
 * Render the workspace roster.
 * @param props - the pick action.
 * @returns the roster.
 */
export function WorkspaceView({ initialWorkspaceId, onPick }: WorkspaceViewProps) {
  const [items, setItems] = useState<WorkspaceRow[] | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    void listWorkspaces().then(
      (rows) => {
        if (cancelled) return
        const target = initialWorkspaceId === undefined
          ? undefined
          : rows.find(workspace => workspace.workspaceId === initialWorkspaceId)
        if (target !== undefined) {
          onPick(target)
          return
        }
        setItems(rows)
      },
      (reason: unknown) => {
        if (cancelled) return
        setError(errorText(reason))
      },
    )
    return () => { cancelled = true }
  }, [initialWorkspaceId, onPick])

  if (error !== undefined) {
    return (
      <div className="mobile">
        <header className="mobile-header">
          <h1 className="mobile-title">工作区</h1>
          <ThemeToggle />
        </header>
        <div className="mobile-empty">
          <p className="mobile-error">加载失败：{error}</p>
          <button type="button" className="mobile-button" onClick={() => { setError(undefined); setItems(undefined) }}>
            重试
          </button>
        </div>
      </div>
    )
  }

  if (items === undefined) {
    return (
      <div className="mobile">
        <header className="mobile-header">
          <h1 className="mobile-title">工作区</h1>
          <ThemeToggle />
        </header>
        <div className="mobile-empty">
          <p className="mobile-muted">加载中…</p>
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="mobile">
        <header className="mobile-header">
          <h1 className="mobile-title">工作区</h1>
          <ThemeToggle />
        </header>
        <div className="mobile-empty">
          <span className="mobile-emptyIcon" aria-hidden>◇</span>
          <p className="mobile-muted">暂无工作区</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mobile">
      <header className="mobile-header">
        <h1 className="mobile-title">工作区</h1>
        <ThemeToggle />
      </header>
      <ul className="mobile-list">
        {items.map(workspace => (
          <li key={workspace.workspaceId}>
            <button type="button" className="mobile-row" onClick={() => { onPick(workspace) }}>
              <span className="mobile-rowIcon" aria-hidden>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
                </svg>
              </span>
              <span className="mobile-rowMain">
                <span className="mobile-rowTitle">{workspace.title}</span>
                <span className="mobile-rowMeta">{workspace.path}</span>
              </span>
              <span className="mobile-chevron" aria-hidden>›</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
