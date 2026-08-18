import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { LAN_BRIDGE_HEADER, isAllowedLanAddress, isTrustedLanBridgeRequest } from '../src/lan-bridge.ts'

describe('LAN mobile bridge allowlist', () => {
  it('accepts exact addresses and CIDR members', () => {
    expect(isAllowedLanAddress('192.168.1.23', '192.168.1.23')).toBe(true)
    expect(isAllowedLanAddress('::ffff:192.168.1.23', '192.168.1.0/24')).toBe(true)
    expect(isAllowedLanAddress('10.2.3.4', '10.0.0.0/8, 192.168.1.0/24')).toBe(true)
  })

  it('rejects non-members and invalid entries; always allows loopback', () => {
    expect(isAllowedLanAddress('192.168.2.23', '192.168.1.0/24')).toBe(false)
    expect(isAllowedLanAddress('192.168.1.23', '')).toBe(false)
    // Loopback is intentionally always allowed so the default bridge can run
    // safely on 127.0.0.1 even with an empty allowlist.
    expect(isAllowedLanAddress('127.0.0.1', '')).toBe(true)
    expect(isAllowedLanAddress('::1', '')).toBe(true)
    expect(isAllowedLanAddress('::2', '')).toBe(false)
  })
})

describe('LAN bridge internal marker', () => {
  const request = (remoteAddress: string, header?: string): IncomingMessage => ({
    socket: { remoteAddress },
    headers: header === undefined ? {} : { [LAN_BRIDGE_HEADER]: header },
  }) as unknown as IncomingMessage

  it('requires loopback and the exact process-local secret', () => {
    expect(isTrustedLanBridgeRequest(request('127.0.0.1', 'secret'), 'secret')).toBe(true)
    expect(isTrustedLanBridgeRequest(request('::ffff:127.0.0.1', 'secret'), 'secret')).toBe(true)
    expect(isTrustedLanBridgeRequest(request('127.0.0.1', 'wrong'), 'secret')).toBe(false)
    expect(isTrustedLanBridgeRequest(request('192.168.1.23', 'secret'), 'secret')).toBe(false)
  })
})
