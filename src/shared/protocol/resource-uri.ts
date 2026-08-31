const BARE_INFO_HASH_RE = /^(?:[a-f0-9]{40}|[a-z2-7]{32})$/i

const DIRECT_RESOURCE_PROTOCOLS = new Set(['http:', 'https:', 'ftp:', 'sftp:'])

export function normalizeBareInfoHash(input: string): string {
  const trimmed = input.trim()
  return BARE_INFO_HASH_RE.test(trimmed)
    ? `magnet:?xt=urn:btih:${trimmed}`
    : trimmed
}

export function isMagnetUri(input: string): boolean {
  return input.toLowerCase().startsWith('magnet:?')
}

export function isThunderUri(input: string): boolean {
  return input.toLowerCase().startsWith('thunder://')
}

export function isEd2kUri(input: string): boolean {
  return input.toLowerCase().startsWith('ed2k://|file|')
}

export function isHttpFamilyUri(input: string): boolean {
  const lower = input.toLowerCase()
  return lower.startsWith('http://') || lower.startsWith('https://')
}

export function isFtpFamilyUri(input: string): boolean {
  const lower = input.toLowerCase()
  return lower.startsWith('ftp://') || lower.startsWith('sftp://')
}

export function decodeThunderUri(input: string): string | null {
  const trimmed = input.trim()
  if (!isThunderUri(trimmed)) return null

  const payload = trimmed.slice('thunder://'.length)
  if (!payload) return null

  try {
    const padded = payload
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(payload.length / 4) * 4, '=')
    const decoded = globalThis.atob(padded)
    if (!decoded.startsWith('AA') || !decoded.endsWith('ZZ')) return null
    const inner = decoded.slice(2, -2).trim()
    return isDownloadableResourceUri(inner) ? inner : null
  } catch {
    return null
  }
}

export function normalizeResourceUriLine(input: string): string {
  const normalized = normalizeBareInfoHash(input)
  const thunder = decodeThunderUri(normalized)
  return thunder ?? normalized
}

export function isDirectResourceUri(input: string): boolean {
  try {
    const parsed = new URL(input)
    return DIRECT_RESOURCE_PROTOCOLS.has(parsed.protocol)
  } catch {
    return false
  }
}

export function isDownloadableResourceUri(input: string): boolean {
  const normalized = normalizeBareInfoHash(input)
  if (isThunderUri(normalized)) return decodeThunderUri(normalized) !== null
  return isMagnetUri(normalized) || isDirectResourceUri(normalized)
}

export function splitResourceUriLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => normalizeResourceUriLine(line))
    .filter((line) => line.length > 0)
}
