type BrowserUuidCrypto = Partial<Pick<Crypto, 'randomUUID' | 'getRandomValues'>>

/** Secure opaque IDs shared across browser hosts, including non-secure HTTP.
 * Never substitute weak randomness when browser cryptography is unavailable. */
export function browserRandomUuid(source: BrowserUuidCrypto | null | undefined = globalThis.crypto): string {
  if (typeof source?.randomUUID === 'function') return source.randomUUID()
  if (typeof source?.getRandomValues !== 'function') throw new Error('Secure browser randomness is unavailable; cannot generate a UUID.')
  const bytes = new Uint8Array(16)
  source.getRandomValues(bytes)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
