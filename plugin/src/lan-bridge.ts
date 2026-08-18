/**
 * Opt-in LAN bridge for the standalone mobile surface.
 *
 * DSH intentionally keeps its main web server on loopback. This bridge opens
 * a separate listener that proxies only `/m` and `/m/*`, rejects clients
 * outside an explicit IPv4/CIDR allowlist, strips Tailscale identity headers,
 * and marks the internal hop with an unguessable process-local secret.
 */

import { createServer, request as requestHttp, type IncomingMessage, type Server } from 'node:http'

/** Header used only on the bridge-to-loopback hop. */
export const LAN_BRIDGE_HEADER = 'x-dsh-lan-bridge-secret'

/** Runtime configuration for the optional listener. */
export interface LanBridgeConfig {
  enabled: boolean
  port: number
  allowedCidrs: string
}

interface ParsedCidr {
  network: number
  mask: number
}

/** Parse an IPv4 address to an unsigned 32-bit number. */
function parseIPv4(value: string): number | undefined {
  const parts = value.split('.')
  if (parts.length !== 4) return undefined
  let result = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined
    const octet = Number(part)
    if (octet < 0 || octet > 255) return undefined
    result = ((result << 8) | octet) >>> 0
  }
  return result
}

/** Normalize Node's IPv4-mapped socket form. */
function normalizeRemoteAddress(value: string | undefined): string | undefined {
  if (value?.startsWith('::ffff:') === true) return value.slice(7)
  return value
}

/** Parse one IP or CIDR expression. A plain address means /32. */
function parseCidr(value: string): ParsedCidr | undefined {
  const [addressText, prefixText = '32', extra] = value.trim().split('/')
  if (extra !== undefined) return undefined
  const address = parseIPv4(addressText)
  const prefix = Number(prefixText)
  if (address === undefined || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return undefined
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return { network: (address & mask) >>> 0, mask }
}

/** Whether a remote IPv4 address belongs to the comma/newline-separated allowlist. */
export function isAllowedLanAddress(remoteAddress: string | undefined, allowedCidrs: string): boolean {
  const normalized = normalizeRemoteAddress(remoteAddress)
  if (normalized === undefined) return false
  // Loopback is always allowed: with an empty allowlist the bridge binds to
  // 127.0.0.1 only, and with a LAN allowlist a local preview must keep working.
  if (normalized === '127.0.0.1' || normalized === '::1') return true
  const address = parseIPv4(normalized)
  if (address === undefined) return false
  const entries = allowedCidrs.split(/[\s,;]+/).filter(Boolean).map(parseCidr).filter((item): item is ParsedCidr => item !== undefined)
  return entries.some(entry => ((address & entry.mask) >>> 0) === entry.network)
}

/** Verify the process-local marker on the loopback side of the bridge. */
export function isTrustedLanBridgeRequest(req: IncomingMessage, secret: string): boolean {
  const remoteAddress = normalizeRemoteAddress(req.socket.remoteAddress)
  if (remoteAddress !== '127.0.0.1' && remoteAddress !== '::1') return false
  return req.headers[LAN_BRIDGE_HEADER] === secret
}

/** Lifecycle wrapper used by the host plugin settings synchronizer. */
export class LanMobileBridge {
  private server: Server | undefined
  private activeKey = ''

  constructor(
    private readonly targetPort: number,
    private readonly secret: string,
  ) {}

  sync(config: LanBridgeConfig): void {
    const key = config.enabled ? `${String(config.port)}|${config.allowedCidrs}` : ''
    if (key === this.activeKey) return
    this.stop()
    if (!config.enabled) return

    const allowLan = config.allowedCidrs.trim().length > 0
    if (!allowLan) {
      console.warn('remote-web-ui: LAN bridge is listening on 127.0.0.1 only; add lanAllowedCidrs to let phones on the LAN connect')
    }

    const server = createServer((req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://lan.invalid').pathname
      if (pathname !== '/m' && !pathname.startsWith('/m/')) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('LAN bridge exposes only the DSH mobile surface')
        return
      }
      if (!isAllowedLanAddress(req.socket.remoteAddress, config.allowedCidrs)) {
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('LAN device is not allowed')
        return
      }

      const headers: Record<string, string | string[] | undefined> = {
        ...req.headers,
        [LAN_BRIDGE_HEADER]: this.secret,
      }
      delete headers['tailscale-user-login']
      delete headers['tailscale-user-name']
      delete headers['tailscale-user-profile-pic']
      delete headers['tailscale-user-tailnet']
      delete headers['tailscale-app-capabilities']
      const upstream = requestHttp({
        hostname: '127.0.0.1',
        port: this.targetPort,
        method: req.method,
        path: req.url,
        headers,
      }, (upstreamResponse) => {
        res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
        upstreamResponse.pipe(res)
      })
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('DSH mobile backend is unavailable')
      })
      req.pipe(upstream)
    })
    server.on('error', error => {
      console.warn(`remote-web-ui: LAN bridge failed: ${String(error)}`)
    })
    server.listen(config.port, allowLan ? '0.0.0.0' : '127.0.0.1')
    this.server = server
    this.activeKey = key
  }

  stop(): void {
    this.server?.close()
    this.server = undefined
    this.activeKey = ''
  }
}
