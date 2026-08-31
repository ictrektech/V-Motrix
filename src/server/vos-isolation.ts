import { createHash } from 'node:crypto'

export interface VosUser {
  readonly subject: string
  readonly username: string
  readonly namespace: string
}

function claim(claims: Record<string, unknown>, ...names: string[]): string {
  for (const name of names) {
    const value = claims[name]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }
  }
  return ''
}

export function userFromPayload(payload: unknown): VosUser {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('invalid VOS userinfo response')
  }
  const outer = payload as Record<string, unknown>
  if (typeof outer.code === 'number' && outer.code !== 0) {
    throw new Error(`VOS rejected token (code ${outer.code})`)
  }
  const nested = outer.data
  const claims =
    nested && typeof nested === 'object' && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : outer
  const subject = claim(claims, 'sub', 'id', 'user_id')
  const username = claim(
    claims,
    'preferred_username',
    'username',
    'name',
    'nickname',
    'email'
  )
  if (!subject) throw new Error('VOS userinfo is missing immutable subject')
  if (!username) throw new Error('VOS userinfo is missing username')
  const namespace = createHash('sha256')
    .update(`v-motrix-vos-oidc\0${subject}`)
    .digest('hex')
    .slice(0, 40)
  return Object.freeze({ subject, username, namespace })
}

export function rewritePaths(
  value: unknown,
  from: string,
  to: string
): unknown {
  if (typeof value === 'string') {
    if (value === from) return to
    if (value.startsWith(`${from}/`)) return `${to}${value.slice(from.length)}`
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewritePaths(item, from, to))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        rewritePaths(item, from, to),
      ])
    )
  }
  return value
}
