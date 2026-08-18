/**
 * Temporary R11 diagnostics for the mobile directory-flow override. A
 * self-dismissing toast shown only on remote (non-loopback) pages that reports,
 * live:
 *   - whether the override entry registered for each hole,
 *   - whether the dsh connection reached "connected" (hostDescription present),
 *   - the workspace-list store state/phase/items plus the RPC error when present,
 *   - a short transition log (so a screenshot shows the SEQUENCE, not a single
 *     instantaneous value).
 * The toast's presence also proves the new bundle loaded.
 *
 * REMOVE this file (and the diagnostic wiring in client/index.ts) once the
 * mobile fix is confirmed on a phone.
 */
import { useEffect, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'

/** Live diagnostic state, keyed by slot name; written by client/index.ts. */
export type FlowDiagEntry = string | (() => void)
export const flowDiag: Record<string, FlowDiagEntry> = {}

const wrapStyle: CSSProperties = {
  position: 'fixed',
  zIndex: 9999,
  top: 12,
  right: 12,
  maxWidth: 'min(380px, calc(100vw - 24px))',
  boxSizing: 'border-box',
  background: 'rgba(15, 17, 22, 0.95)',
  color: '#e8eaed',
  borderRadius: 10,
  padding: '10px 14px',
  fontSize: 12,
  lineHeight: 1.6,
  fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
  boxShadow: '0 6px 24px rgba(0, 0, 0, 0.4)',
}
const rowStyle: CSSProperties = { display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }
const okStyle: CSSProperties = { color: '#5ad07a', fontWeight: 700 }
const badStyle: CSSProperties = { color: '#ff6b6b', fontWeight: 700 }
const titleStyle: CSSProperties = { fontWeight: 700, marginBottom: 2 }
const closeStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#9aa0a6',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
  padding: 2,
}
const refreshStyle: CSSProperties = {
  background: '#2a2d31',
  border: '1px solid #45494f',
  color: '#e8eaed',
  borderRadius: 6,
  padding: '2px 10px',
  fontSize: 11,
  cursor: 'pointer',
}

const cell = (state: string): ReactElement =>
  state === 'registered'
    ? <span style={okStyle}>已注册 ✓</span>
    : state === 'pending'
      ? <span style={badStyle}>未注册 ⏳</span>
      : <span style={badStyle}>{state}</span>

const listCell = (raw: string | undefined): ReactElement => {
  const text = raw ?? '—'
  const ok = raw !== undefined && raw.includes('ready') && raw.includes('items=') && !raw.includes('err=')
  return <span style={ok ? okStyle : badStyle}>{text}</span>
}

const connCell = (raw: string | undefined): ReactElement => {
  const text = raw ?? '—'
  const ok = text === '已连接'
  return <span style={ok ? okStyle : badStyle}>{text}</span>
}

/**
 * Self-updating diagnostic toast. Re-renders every 500ms to reflect live
 * `flowDiag` state (registration/connection settling happens async after boot),
 * auto dismisses after 60s, and offers a manual close + manual list refresh.
 */
export function FlowDiagToast(): ReactElement | null {
  const [, setTick] = useState(0)
  const [gone, setGone] = useState(false)
  useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), 500)
    const dismiss = window.setTimeout(() => setGone(true), 60_000)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(dismiss)
    }
  }, [])
  if (gone) return null
  const onRefresh = flowDiag['refresh']
  return (
    <div style={wrapStyle} role="status">
      <div style={{ ...rowStyle, ...titleStyle }}>
        <span>dsh-mobile 诊断 R11</span>
        <button onClick={() => setGone(true)} style={closeStyle} aria-label="close">×</button>
      </div>
      <div style={rowStyle}>
        <span>侧边栏覆盖</span>
        {cell(flowDiag['sidebar.workspaces.directoryFlow'] as string ?? 'pending')}
      </div>
      <div style={rowStyle}>
        <span>对话栏覆盖</span>
        {cell(flowDiag['conversation.hero.workspace.directoryFlow'] as string ?? 'pending')}
      </div>
      <div style={rowStyle}>
        <span>连接状态</span>
        {connCell(flowDiag['conn'] as string)}
      </div>
      <div style={rowStyle}>
        <span>工作区列表</span>
        {listCell(flowDiag['list'] as string)}
      </div>
      <div style={{ ...rowStyle, alignItems: 'flex-start' }}>
        <span>转换日志</span>
        <span style={{ color: '#9aa0a6', textAlign: 'right', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {flowDiag['log'] as string ?? '—'}
        </span>
      </div>
      <div style={{ ...rowStyle, justifyContent: 'flex-end' }}>
        {typeof onRefresh === 'function'
          ? <button type="button" style={refreshStyle} onClick={() => onRefresh()}>手动刷新列表</button>
          : null}
      </div>
    </div>
  )
}
