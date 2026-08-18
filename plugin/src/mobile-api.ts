/**
 * The mobile surface's data channel: `/m/api` proxies the host ApiProxy
 * service for the standalone phone page. The phone's RPC calls ride THIS
 * prefix instead of the connection plugin's `/api` — so the tunneled Host
 * never needs to enter the connection trust fence (a distributable plugin
 * cannot change that fence), and this plugin's own pairing gate is the
 * access control instead.
 *
 * Security model:
 * - Every request must carry a live paired-device cookie (the same gate
 *   semantic as the LAN fence), enforced before any host call.
 * - Only an explicit allowlist of methods is proxied; privileged domains
 *   (settings, credentials, host actions, goals, subagents, …) are never
 *   reachable from the phone.
 * - `session.list` is paged here (the host API returns everything; this
 *   layer slices stable pages) so the phone never transfers the whole list.
 * - The live mux stream is bridged over Server-Sent Events on the same
 *   prefix (one-directional push; answers to questions/approvals ride the
 *   unary channel), gated identically.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import type { ClientResponse, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import type { PairingService } from './pairing.ts'
import { isLoopbackClient, isLoopbackHostname, readCookie } from './gate.ts'

/** Methods the phone surface may call. Everything else is refused. */
const MOBILE_ALLOWLIST = new Set([
  'workspace.list',
  'session.create',
  'session.list',
  'session.history',
  'session.search',
  'session.prompt',
  'session.models',
  'session.selectModel',
  'session.rename',
  'skill.list',
  'costMeter.getState',
  'costMeter.refreshBalance',
  'approval.respond',
  'question.respond',
  'mobile.pending',
])

/**
 * Locally answered display-preference method (the phone's read-only
 * surface preferences; never proxied to the host ApiProxy and never a
 * settings-domain write).
 */
const MOBILE_PREFERENCES_METHOD = 'mobile.preferences'

/** One session.list page (thin phones load incrementally). */
const SESSION_PAGE_SIZE = 20
/** SSE keep-alive ping cadence for the live mux stream (single connection). */
const DEFAULT_EVENTS_HEARTBEAT_MS = 15_000

/** Encode one list position as an opaque continuation cursor. */
function sessionListCursor(updatedAt: number, sessionId: string): string {
  return `${updatedAt}:${sessionId}`
}

/** Parse a cursor; malformed cursors mean "start over" (safe failure mode). */
function parseSessionListCursor(cursor: string): { updatedAt: number; sessionId: string } | undefined {
  const separator = cursor.indexOf(':')
  if (separator < 0) return undefined
  const updatedAt = Number(cursor.slice(0, separator))
  if (!Number.isFinite(updatedAt)) return undefined
  return { updatedAt, sessionId: cursor.slice(separator + 1) }
}

/** Whether a row comes strictly after the cursor position. */
function afterCursor(row: { updatedAt: number; sessionId: string }, position: { updatedAt: number; sessionId: string }): boolean {
  return row.updatedAt < position.updatedAt
    || (row.updatedAt === position.updatedAt && row.sessionId > position.sessionId)
}

/** Minimal dsh-cost-meter service face exposed to the mobile surface. */
export interface MobileCostMeterService {
  getState(): Promise<unknown>
  refreshBalance(): Promise<unknown>
}

/** Route-family dependencies. */
export interface MobileApiDeps {
  /** The pairing service (device gate + cookie name). */
  service: PairingService
  /** The host ApiProxy service (injected by the plugin). */
  apiProxy: ApiProxy
  /** The resolved mobile composer preference (live per request). */
  mobileEnterToSend: () => boolean
  /** Tailscale Serve app capability allowed to use /m/api without pairing. */
  tailnetCapability?: () => string
  /** Process-local verifier for requests forwarded by the opt-in LAN bridge. */
  trustedLanBridgeRequest?: (req: IncomingMessage) => boolean
  /** Optional dsh-cost-meter host service (undefined when not installed). */
  costMeter?: () => MobileCostMeterService | undefined
  /** SSE keep-alive ping cadence for the mux stream (default 15000 ms; test seam). */
  eventsHeartbeatMs?: number
}

/** Mobile API route paths. */
export const MOBILE_API_PATHS = {
  events: '/m/api/events.mux',
} as const

/** The mobile-api prefix (every other path under it is a method name). */
const MOBILE_API_PREFIX = '/m/api'
/** Method extraction: the prefix plus one slash. */
const MOBILE_API_METHOD_PREFIX = `${MOBILE_API_PREFIX}/`

/**
 * Host-action endpoints the plugin re-exposes to the paired mobile surface.
 * The connection plugin gates `host.pickDirectory` / `host.openPath` to
 * loopback (native dialogs act on the host machine), which a phone arriving
 * via Tailscale Serve can never satisfy — Serve preserves the MagicDNS Host.
 * These exact routes match before the connection plugin's `/api` prefix, so
 * they own the request and apply this plugin's pairing gate (loopback, a
 * paired device cookie, a Tailscale app capability, or the LAN bridge secret)
 * in place of the Host fence.
 */
const HOST_ACTION_PATHS = {
  pickDirectory: '/api/host.pickDirectory',
  openPath: '/api/host.openPath',
} as const

/**
 * Tailscale Serve capability bypass for the mobile data channel.
 *
 * Serve strips caller-supplied Tailscale identity/capability headers before it
 * injects the peer's granted capabilities. The backend still requires a
 * loopback proxy connection and browser same-origin markers, so a LAN caller
 * cannot forge this bypass by supplying the header directly.
 */
export function isTrustedTailnetCapabilityRequest(req: IncomingMessage, capability: string): boolean {
  if (capability === '') return false
  const remoteAddress = (req.socket as { remoteAddress?: string } | undefined)?.remoteAddress
  if (remoteAddress !== '127.0.0.1' && remoteAddress !== '::1' && remoteAddress !== '::ffff:127.0.0.1') return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false

  const host = req.headers.host
  const origin = req.headers.origin
  if (typeof host !== 'string') return false
  if (origin !== undefined) {
    try {
      if (new URL(origin).host !== new URL(`http://${host}`).host) return false
    } catch {
      return false
    }
  }

  const header = req.headers['tailscale-app-capabilities']
  if (typeof header !== 'string') return false
  try {
    const parsed = JSON.parse(header) as unknown
    return typeof parsed === 'object'
      && parsed !== null
      && Object.prototype.hasOwnProperty.call(parsed, capability)
      && Array.isArray((parsed as Record<string, unknown>)[capability])
  } catch {
    return false
  }
}

/**
 * Tailscale Serve identity bypass for the mobile data channel.
 *
 * Tailscale Serve injects authenticated Tailnet user headers on the loopback
 * hop. This lets a phone on the Tailnet open `/m` without configuring an app
 * capability or pairing cookie; the mobile channel remains method-allowlisted
 * and the request must still come from loopback with a same-origin browser
 * marker. The LAN bridge strips these headers, so this path is only reachable
 * through an actual Tailscale Serve proxy.
 */
export function isTrustedTailnetServeRequest(req: IncomingMessage): boolean {
  const remoteAddress = (req.socket as { remoteAddress?: string } | undefined)?.remoteAddress
  if (remoteAddress !== '127.0.0.1' && remoteAddress !== '::1' && remoteAddress !== '::ffff:127.0.0.1') return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false

  const host = req.headers.host
  const origin = req.headers.origin
  if (typeof host !== 'string') return false
  if (origin !== undefined) {
    try {
      if (new URL(origin).host !== new URL(`http://${host}`).host) return false
    } catch {
      return false
    }
  }

  const login = req.headers['tailscale-user-login']
  const name = req.headers['tailscale-user-name']
  return (typeof login === 'string' && login !== '') || (typeof name === 'string' && name !== '')
}

/**
 * Loopback reverse-proxy bypass for the mobile data channel.
 *
 * Tailscale Serve (and other local reverse proxies) terminate the Tailnet
 * HTTPS connection and forward to this process over loopback. This fallback
 * accepts a loopback request with a browser same-origin marker even when the
 * Serve build does not inject Tailnet identity headers. The mobile channel
 * stays method-allowlisted; this only changes the transport gate from
 * "paired cookie / capability / identity header" to also trust the local
 * reverse proxy hop.
 */
export function isTrustedLoopbackProxyRequest(req: IncomingMessage): boolean {
  const remoteAddress = (req.socket as { remoteAddress?: string } | undefined)?.remoteAddress
  if (remoteAddress !== '127.0.0.1' && remoteAddress !== '::1' && remoteAddress !== '::ffff:127.0.0.1') return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false

  const host = req.headers.host
  const origin = req.headers.origin
  if (typeof host !== 'string') return false
  let hostname: string
  try {
    hostname = new URL(`http://${host}`).hostname
  } catch {
    return false
  }
  // Only reverse-proxied non-loopback Hosts are trusted here; direct
  // http://127.0.0.1/m still requires a paired cookie or the LAN bridge.
  if (isLoopbackHostname(hostname)) return false
  if (origin !== undefined) {
    try {
      if (new URL(origin).host !== new URL(`http://${host}`).host) return false
    } catch {
      return false
    }
  }
  return true
}

/**
 * Build the mobile data-channel routes.
 * @param deps - pairing service + apiProxy.
 * @returns the routes to register on webServer.
 */
export function makeMobileApiRoutes(deps: MobileApiDeps): WebRoute[] {
  const { service, apiProxy, mobileEnterToSend } = deps
  const tailnetCapability = deps.tailnetCapability ?? (() => '')
  const trustedLanBridgeRequest = deps.trustedLanBridgeRequest ?? (() => false)
  const costMeter = deps.costMeter ?? (() => undefined)
  const eventsHeartbeatMs = deps.eventsHeartbeatMs ?? DEFAULT_EVENTS_HEARTBEAT_MS

  /**
   * Refresh the paired device's presence and report whether it is live.
   * The mobile surface (unlike the desktop Web UI) has no `/api/pair/heartbeat`
   * sender, so any activity on the mobile channel — a gated RPC, or the live
   * SSE stream staying open — must count as presence. Without this, an
   * idle-but-connected phone ages past `offlineAfterMs` and the desktop panel
   * wrongly reports it as disconnected.
   */
  const touchDeviceFor = (req: IncomingMessage): boolean => {
    const deviceId = readCookie(req.headers.cookie, service.config.cookieName)
    if (deviceId === undefined) return false
    return service.touchDevice(deviceId)
  }

  /**
   * The phone gate: a live paired-device cookie, a Tailscale Serve identity
   * header, a loopback reverse proxy, an app capability, or the trusted LAN
   * bridge may proceed.
   */
  const gateOk = (req: IncomingMessage): boolean => {
    return touchDeviceFor(req)
      || isTrustedTailnetServeRequest(req)
      || isTrustedLoopbackProxyRequest(req)
      || isTrustedTailnetCapabilityRequest(req, tailnetCapability())
      || trustedLanBridgeRequest(req)
  }

  const writeJson = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }

  const handleMethod = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    if (!gateOk(req)) {
      writeJson(res, 403, { ok: false, error: { code: 'unpaired', message: 'mobile session is not paired' } })
      return
    }
    const pathname = new URL(req.url ?? '/', 'http://x').pathname
    if (!pathname.startsWith(MOBILE_API_METHOD_PREFIX)) {
      writeJson(res, 404, { ok: false, error: { code: 'not-found', message: 'unknown mobile api path' } })
      return
    }
    const method = pathname.slice(MOBILE_API_METHOD_PREFIX.length)
    const local = method === MOBILE_PREFERENCES_METHOD
    if (!MOBILE_ALLOWLIST.has(method) && !local) {
      writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: `method ${method} is not exposed to the mobile surface` } })
      return
    }
    let envelope: unknown
    try {
      envelope = await readJsonBody(req)
    } catch {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'invalid json body' } })
      return
    }
    const parsed = envelope as { rpcId?: unknown; payload?: unknown }
    const rpcId = typeof parsed?.rpcId === 'string' ? parsed.rpcId : ''
    if (rpcId === '') {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'missing rpcId' } })
      return
    }
    if (local) {
      writeJson(res, 200, {
        type: 'server-response',
        rpcId,
        result: { ok: true, value: { mobileEnterToSend: mobileEnterToSend() } },
      })
      return
    }
    try {
      const response = await dispatch(apiProxy, method, parsed?.payload, rpcId, costMeter())
      writeJson(res, 200, response)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      writeJson(res, 200, {
        type: 'server-response',
        rpcId,
        result: { ok: false, error: { code: 'internal', message } },
      })
    }
  }

  /** Bridge the host mux stream over SSE: one `data:` frame per mux frame. */
  const handleEvents = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'GET') {
      res.writeHead(405)
      res.end()
      return
    }
    if (!gateOk(req)) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const controller = new AbortController()
    let closed = false
    const heartbeat = setInterval(() => {
      if (closed) return
      // An open SSE stream proves the phone is still live even while the agent
      // idles (no RPC traffic), so refresh presence alongside the transport
      // keepalive — otherwise an idle phone drifts to "disconnected".
      touchDeviceFor(req)
      try {
        res.write(': ping\n\n')
      } catch {
        // The write failed; the close handler tears the subscription down.
      }
    }, eventsHeartbeatMs)
    const onClose = (): void => {
      if (closed) return
      closed = true
      controller.abort()
      clearInterval(heartbeat)
    }
    res.on('close', onClose)
    req.on('close', onClose)
    try {
      const frames = apiProxy.events.mux({ rpcId: RpcId(`mobile-mux-${Date.now().toString(36)}`), payload: {} }, controller.signal)
      for await (const frame of frames) {
        if (closed) break
        res.write(`data: ${JSON.stringify(frame)}\n\n`)
      }
    } catch {
      // The stream ended or errored; the EventSource reconnects.
    } finally {
      controller.abort()
      clearInterval(heartbeat)
    }
    if (!closed) res.end()
  }

  /**
   * Host-action handler for the exact `/api/host.pickDirectory` and
   * `/api/host.openPath` routes. These ride the connection plugin's own
   * `/api` prefix (so the stock Web UI keeps calling the same path), but the
   * exact match wins over the connection prefix and replaces its Host fence
   * with this plugin's gate: loopback passes through unchanged (the desktop
   * keeps its native dialogs), while a non-loopback caller must be a live
   * paired device, a Tailscale-capability bearer, or the LAN bridge. The host
   * dialog itself is driven in-process via the injected ApiProxy, so the
   * privileged method never has to satisfy the connection loopback check.
   */
  const handleHostAction = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    if (!isLoopbackClient(req) && !gateOk(req)) {
      writeJson(res, 403, { ok: false, error: { code: 'unpaired', message: 'mobile session is not paired' } })
      return
    }
    const pathname = new URL(req.url ?? '/', 'http://x').pathname
    const isPickDirectory = pathname === HOST_ACTION_PATHS.pickDirectory
    let envelope: unknown
    try {
      envelope = await readJsonBody(req)
    } catch {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'invalid json body' } })
      return
    }
    const parsed = envelope as { rpcId?: unknown; payload?: unknown }
    const rpcId = typeof parsed?.rpcId === 'string' ? parsed.rpcId : ''
    if (rpcId === '') {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'missing rpcId' } })
      return
    }
    const request: RpcRequest<unknown> = { rpcId: RpcId(rpcId), payload: parsed?.payload }
    const controller = new AbortController()
    req.on('close', () => { controller.abort() })
    try {
      const response = isPickDirectory
        ? await apiProxy.host.pickDirectory(request as never, controller.signal)
        : await apiProxy.host.openPath(request as never, controller.signal)
      writeJson(res, 200, { type: 'server-response', rpcId, result: response.result })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      writeJson(res, 200, {
        type: 'server-response',
        rpcId,
        result: { ok: false, error: { code: 'internal', message } },
      })
    }
  }

  return [
    { kind: 'prefix', path: MOBILE_API_PREFIX, handler: handleMethod },
    { kind: 'exact', path: MOBILE_API_PATHS.events, handler: handleEvents },
    { kind: 'exact', path: HOST_ACTION_PATHS.pickDirectory, handler: handleHostAction },
    { kind: 'exact', path: HOST_ACTION_PATHS.openPath, handler: handleHostAction },
  ]
}

/** Read a request body as JSON (bounded). */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > 64 * 1024) throw new Error('body too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Dispatch one allowlisted method through the host ApiProxy. */
async function dispatch(apiProxy: ApiProxy, method: string, payload: unknown, rpcId: string, costMeter?: MobileCostMeterService): Promise<unknown> {
  const request: RpcRequest<unknown> = { rpcId: RpcId(rpcId), payload }
  if (method === 'session.list') {
    const full = await apiProxy.sessions.list(request as never)
    if (!full.result.ok) return full
    const items = full.result.value.items as Array<{ updatedAt: number; sessionId: string }>
    const cursor = (payload as { cursor?: string } | undefined)?.cursor
    // Every call pages (the first call with no cursor IS the first page):
    // the phone must never transfer the whole session list at once.
    // One stable page over (updatedAt desc, sessionId asc); pages never skip
    // or repeat a row while the list changes between calls.
    items.sort((a, b) => b.updatedAt - a.updatedAt
      || (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0))
    const position = cursor === undefined ? undefined : parseSessionListCursor(cursor)
    const from = position === undefined ? 0 : items.findIndex(row => afterCursor(row, position))
    const start = from < 0 ? items.length : from
    const page = items.slice(start, start + SESSION_PAGE_SIZE)
    const last = page[page.length - 1]
    const nextCursor = last !== undefined && start + page.length < items.length
      ? sessionListCursor(last.updatedAt, last.sessionId)
      : undefined
    return {
      type: 'server-response',
      rpcId,
      result: {
        ok: true,
        value: {
          items: page,
          hasMore: nextCursor !== undefined,
          ...(nextCursor !== undefined ? { nextCursor } : {}),
        },
      },
    }
  }
  // The ApiProxy unary methods resolve to the internal response shape
  // ({ rpcId, result }) without the transport envelope the phone's callUnary
  // requires — wrap every pass-through in the same 'server-response'
  // envelope session.list builds above.
  const wrap = (response: { rpcId: string; result: unknown }): unknown => ({
    type: 'server-response' as const,
    rpcId,
    result: response.result,
  })
  if (method === 'workspace.list') return wrap(await apiProxy.workspace.list(request as never))
  if (method === 'session.create') return wrap(await apiProxy.sessions.create(request as never))
  if (method === 'session.history') return wrap(await apiProxy.sessions.history(request as never))
  if (method === 'session.search') return wrap(await apiProxy.sessions.search(request as never, new AbortController().signal))
  if (method === 'session.prompt') return wrap(await apiProxy.sessions.prompt(request as never))
  if (method === 'session.models') return wrap(await apiProxy.sessions.models(request as never))
  if (method === 'session.selectModel') return wrap(await apiProxy.sessions.selectModel(request as never))
  if (method === 'session.rename') return wrap(await apiProxy.sessions.rename(request as never))
  if (method === 'skill.list') return wrap(await apiProxy.skills.list(request as never))
  if (method === 'costMeter.getState') {
    if (costMeter === undefined) throw new Error('dsh-cost-meter is not installed')
    return {
      type: 'server-response' as const,
      rpcId,
      result: { ok: true, value: await costMeter.getState() },
    }
  }
  if (method === 'costMeter.refreshBalance') {
    if (costMeter === undefined) throw new Error('dsh-cost-meter is not installed')
    return {
      type: 'server-response' as const,
      rpcId,
      result: { ok: true, value: await costMeter.refreshBalance() },
    }
  }
  if (method === 'approval.respond') {
    const body = payload as { rpcId?: unknown; sessionId?: unknown; approvalId?: unknown; outcome?: unknown }
    const serverRpcId = typeof body?.rpcId === 'string' ? body.rpcId : ''
    const sessionId = body?.sessionId
    const approvalId = body?.approvalId
    const outcome = body?.outcome
    if (serverRpcId === '' || sessionId === undefined || approvalId === undefined || (outcome !== 'allowed-once' && outcome !== 'rejected')) {
      throw new Error('invalid approval.respond payload')
    }
    const message: ClientResponse = {
      type: 'client-response',
      rpcId: RpcId(serverRpcId),
      result: { ok: true, value: { sessionId, approvalId, outcome } },
    }
    return {
      type: 'server-response' as const,
      rpcId,
      result: { ok: true, value: await apiProxy.respond(message) },
    }
  }
  if (method === 'question.respond') {
    const body = payload as { rpcId?: unknown; sessionId?: unknown; answer?: unknown }
    const serverRpcId = typeof body?.rpcId === 'string' ? body.rpcId : ''
    const sessionId = body?.sessionId
    const answer = body?.answer
    if (serverRpcId === '' || sessionId === undefined || answer === undefined) {
      throw new Error('invalid question.respond payload')
    }
    const message: ClientResponse = {
      type: 'client-response',
      rpcId: RpcId(serverRpcId),
      result: { ok: true, value: { sessionId, answer } },
    }
    return {
      type: 'server-response' as const,
      rpcId,
      result: { ok: true, value: await apiProxy.respond(message) },
    }
  }
  if (method === 'mobile.pending') {
    const sessionId = (payload as { sessionId?: unknown })?.sessionId
    if (typeof sessionId !== 'string' || sessionId === '') {
      throw new Error('invalid mobile.pending payload')
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => { controller.abort() }, 2000)
    const approvals: unknown[] = []
    const questions: unknown[] = []
    try {
      const frames = apiProxy.events.mux({ rpcId: RpcId(`mobile-pending-${Date.now().toString(36)}`), payload: {} }, controller.signal)
      for await (const frame of frames) {
        const framePayload = frame.payload as { type?: string; sessionId?: unknown } | undefined
        if (framePayload?.type === 'approval/requested' && framePayload.sessionId === sessionId) {
          approvals.push({ rpcId: frame.rpcId, ...framePayload })
        } else if (framePayload?.type === 'question/requested' && framePayload.sessionId === sessionId) {
          questions.push({ rpcId: frame.rpcId, ...framePayload })
        }
      }
    } catch {
      // Timeout/abort ends the replay window; collected frames are still valid.
    } finally {
      clearTimeout(timeout)
    }
    return {
      type: 'server-response' as const,
      rpcId,
      result: { ok: true, value: { approvals, questions } },
    }
  }
  throw new Error(`unhandled allowlisted method ${method}`)
}
