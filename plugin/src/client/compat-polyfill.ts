/**
 * Browser-compatibility polyfills for the phone surface. dsh core's client
 * code (`@deepseek-ai/dsh-client-connection`) uses modern Web APIs
 * unconditionally in its fetch carrier — notably `AbortSignal.timeout` for
 * every unary RPC (connection handshake `host.describe`, `workspace.list`,
 * …). A phone browser/WebView older than those APIs throws
 * `AbortSignal.timeout is not a function` inside `postJson`, so the
 * connection never reaches `connected` and the workspace baseline never loads
 * (the R10 phone test caught exactly this error). The fork cannot modify dsh
 * core, but it runs in the SAME page realm — so a small, idempotent polyfill
 * installed at module load (and again in `apply()`) heals the whole client.
 *
 * Covers the APIs the phone (Chrome ~92–102 era: has `crypto.randomUUID`,
 * lacks `AbortSignal.timeout`/`.any`) is likely to hit:
 *   - AbortSignal.timeout / AbortSignal.any   (the confirmed blocker)
 *   - Object.hasOwn, Array.prototype.at, Array.prototype.findLast
 *   - structuredClone (dsh-core LLM `freezeMessage`; a JSON+Date+Map/Set
 *     fallback, exact enough for the chat surface)
 */

/** Install the polyfills; safe to call repeatedly. */
export function ensureCompatPolyfills(): void {
  installAbortSignalTimeout()
  installAbortSignalAny()
  installObjectHasOwn()
  installArrayAt()
  installArrayFindLast()
  installStructuredClone()
}

function installAbortSignalTimeout(): void {
  const AS = globalThis.AbortSignal as { timeout?: (ms: number) => AbortSignal }
  if (AS === undefined || typeof AS.timeout === 'function') return
  AS.timeout = (ms: number): AbortSignal => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort(new DOMException('The operation timed out', 'TimeoutError'))
    }, ms)
    controller.signal.addEventListener('abort', () => { clearTimeout(timer) }, { once: true })
    return controller.signal
  }
}

function installAbortSignalAny(): void {
  const AS = globalThis.AbortSignal as unknown as { any?: (signals: Iterable<AbortSignal>) => AbortSignal }
  if (AS === undefined || typeof AS.any === 'function') return
  AS.any = (signals: Iterable<AbortSignal>): AbortSignal => {
    const controller = new AbortController()
    let done = false
    const forward = (signal: AbortSignal): void => {
      if (done) return
      if (signal.aborted) {
        done = true
        controller.abort(signal.reason)
        return
      }
      signal.addEventListener('abort', () => {
        if (done) return
        done = true
        controller.abort(signal.reason)
      }, { once: true })
    }
    for (const signal of signals) {
      forward(signal)
      if (done) break
    }
    return controller.signal
  }
}

function installObjectHasOwn(): void {
  const O = Object as { hasOwn?: (obj: object, key: PropertyKey) => boolean }
  if (typeof O.hasOwn === 'function') return
  O.hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)
}

function installArrayAt(): void {
  const proto = Array.prototype as { at?: (index: number) => unknown }
  if (typeof proto.at === 'function') return
  proto.at = function (this: unknown[], index: number): unknown {
    const len = this.length
    const n = Math.trunc(index) || 0
    if (n < 0) return this[len + n]
    return n < len ? this[n] : undefined
  }
}

function installArrayFindLast(): void {
  const proto = Array.prototype as {
    findLast?: <T>(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: unknown) => T | undefined
  }
  if (typeof proto.findLast === 'function') return
  proto.findLast = function <T>(this: T[], predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: unknown): T | undefined {
    for (let i = this.length - 1; i >= 0; i--) {
      if (predicate.call(thisArg, this[i], i, this)) return this[i]
    }
    return undefined
  }
}

function installStructuredClone(): void {
  const G = globalThis as { structuredClone?: (value: unknown) => unknown }
  if (typeof G.structuredClone === 'function') return
  G.structuredClone = (value: unknown): unknown => cloneValue(value)

  function cloneValue(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value
    if (value instanceof Date) return new Date(value.getTime())
    if (Array.isArray(value)) return value.map(cloneValue)
    if (value instanceof Map) {
      const out = new Map()
      for (const [key, entry] of value) out.set(cloneValue(key), cloneValue(entry))
      return out
    }
    if (value instanceof Set) {
      const out = new Set()
      for (const entry of value) out.add(cloneValue(entry))
      return out
    }
    if (typeof ArrayBuffer !== 'undefined') {
      if (value instanceof ArrayBuffer) return value.slice(0)
      if (ArrayBuffer.isView(value)) {
        const view = value as ArrayBufferView
        const buffer = view.buffer
        // Only ArrayBuffer-backed views clone cleanly; SharedArrayBuffer
        // views fall through to the plain-object copy (never in practice).
        if (buffer instanceof ArrayBuffer) {
          return new (view.constructor as new (buffer: ArrayBuffer) => ArrayBufferView)(buffer.slice(0))
        }
      }
    }
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>)) out[key] = cloneValue((value as Record<string, unknown>)[key])
    return out
  }
}
