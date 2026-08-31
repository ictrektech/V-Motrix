import { sha256 } from '@noble/hashes/sha2.js'
import { resolveWebBase } from './web-base'

export interface VosSessionUser {
  username: string
  namespace: string
}

interface SessionResponse {
  enabled?: boolean
  authenticated?: boolean
  user?: VosSessionUser
  clientId?: string
  scope?: string
}

interface VosOAuth2 {
  authorize(params: Record<string, unknown>): Promise<{
    code: string
    state: string
  }>
  token(params: Record<string, unknown>): Promise<{ access_token?: string }>
}

declare global {
  interface Window {
    vos_platform?: {
      api?: { v1000?: { oauth2?: VosOAuth2 } }
    }
    __VOS_APP_CONTEXT__?: {
      accessToken?: string
      token?: string
    }
    __VOS_ACCESS_TOKEN__?: string
  }
}

const base = resolveWebBase()

function randomBytes(length = 32): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length))
}

function base64Url(value: Uint8Array): string {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function oauth2Bridge(timeoutMs = 3_000): Promise<VosOAuth2 | null> {
  const current = window.vos_platform?.api?.v1000?.oauth2
  if (current) return current
  if (window.parent === window) return null
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => window.setTimeout(resolve, 50))
    const bridge = window.vos_platform?.api?.v1000?.oauth2
    if (bridge) return bridge
  }
  return null
}

async function currentSession(): Promise<SessionResponse> {
  const response = await fetch(`${base}/api/vos/auth/session`, {
    credentials: 'same-origin',
    cache: 'no-store',
  })
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) return { enabled: false }
  const payload = (await response.json()) as SessionResponse
  return response.ok ? payload : { enabled: false }
}

function tokenFromAccessStore(raw: string | null): string | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as Record<string, unknown>
    const token = data.accessToken || data.access_token || data.token
    return typeof token === 'string' && token.trim() ? token.trim() : null
  } catch {
    return null
  }
}

function tokenFromLocalStorage(): string | null {
  try {
    const directKeys = ['core-access', 'VIVIBIT-core-access']
    for (const key of directKeys) {
      const token = tokenFromAccessStore(localStorage.getItem(key))
      if (token) return token
    }
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key?.endsWith('-core-access')) continue
      const token = tokenFromAccessStore(localStorage.getItem(key))
      if (token) return token
    }
  } catch {
    return null
  }
  return null
}

function tokenFromInjectedContext(): string | null {
  const token =
    window.__VOS_APP_CONTEXT__?.accessToken ||
    window.__VOS_APP_CONTEXT__?.token ||
    window.__VOS_ACCESS_TOKEN__
  return typeof token === 'string' && token.trim() ? token.trim() : null
}

async function loginWithAccessToken(
  accessToken: string
): Promise<VosSessionUser | null> {
  const response = await fetch(`${base}/api/vos/auth/login`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ access_token: accessToken }),
  })
  const payload = (await response.json()) as SessionResponse & {
    error?: string
  }
  if (!response.ok || !payload.user) return null
  return payload.user
}

async function exchangeFastpath(
  config: SessionResponse,
  oauth2: VosOAuth2
): Promise<VosSessionUser> {
  const verifier = base64Url(randomBytes())
  const state = base64Url(randomBytes())
  const nonce = base64Url(randomBytes())
  // VOS is commonly reached through a plain HTTP/IP origin. WebCrypto's
  // `subtle` API is unavailable there, so PKCE must use a synchronous,
  // browser-safe SHA-256 implementation rather than crypto.subtle.
  const digest = sha256(new TextEncoder().encode(verifier))
  const clientId = config.clientId || 'com.ictrek.v-motrix'
  const authorized = await oauth2.authorize({
    client_id: clientId,
    response_type: 'code',
    scope: config.scope || 'openid profile email',
    state,
    nonce,
    code_challenge: base64Url(digest),
    code_challenge_method: 'S256',
  })
  if (authorized.state !== state) throw new Error('VOS OIDC state mismatch')
  const tokens = await oauth2.token({
    grant_type: 'authorization_code',
    code: authorized.code,
    code_verifier: verifier,
    client_id: clientId,
  })
  if (!tokens.access_token) {
    throw new Error('VOS OIDC did not return an access token')
  }
  const response = await fetch(`${base}/api/vos/auth/login`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ access_token: tokens.access_token }),
  })
  const payload = (await response.json()) as SessionResponse & {
    error?: string
  }
  if (!response.ok || !payload.user) {
    throw new Error(payload.error || 'VOS login failed')
  }
  return payload.user
}

/** Authenticate before renderer state is initialized. A fresh Fastpath
 * exchange on every page load also detects account switches in the VOS shell. */
export async function bootstrapVosSession(): Promise<VosSessionUser | null> {
  const config = await currentSession()
  if (!config.enabled) return null
  const bridge = await oauth2Bridge()
  if (bridge) return exchangeFastpath(config, bridge)
  const directToken = tokenFromInjectedContext() || tokenFromLocalStorage()
  if (directToken) {
    const user = await loginWithAccessToken(directToken)
    if (user) return user
  }
  if (config.authenticated && config.user) return config.user
  throw new Error('VOS OIDC Fastpath is unavailable')
}

function scopedStorage(source: Storage, prefix: string): Storage {
  const scopedKeys = (): string[] => {
    const keys: string[] = []
    for (let index = 0; index < source.length; index += 1) {
      const key = source.key(index)
      if (key?.startsWith(prefix)) keys.push(key.slice(prefix.length))
    }
    return keys
  }
  return {
    get length() {
      return scopedKeys().length
    },
    clear() {
      for (const key of scopedKeys()) source.removeItem(`${prefix}${key}`)
    },
    getItem(key: string) {
      return source.getItem(`${prefix}${key}`)
    },
    key(index: number) {
      return scopedKeys()[index] ?? null
    },
    removeItem(key: string) {
      source.removeItem(`${prefix}${key}`)
    },
    setItem(key: string, value: string) {
      source.setItem(`${prefix}${key}`, value)
    },
  }
}

function installProperty(
  name: 'localStorage' | 'sessionStorage' | 'indexedDB',
  value: unknown
): void {
  Object.defineProperty(globalThis, name, { configurable: true, value })
}

/** Partition browser persistence by the immutable VOS subject before any
 * application store is hydrated. Falling back to origin-wide storage would
 * expose the previous VOS user's local state. */
export function installVosStoragePartition(namespace: string): void {
  if (!/^[a-f0-9]{40}$/.test(namespace)) {
    throw new Error('Invalid VOS storage namespace')
  }
  const prefix = `v-motrix:${namespace}:`
  installProperty('localStorage', scopedStorage(localStorage, prefix))
  installProperty('sessionStorage', scopedStorage(sessionStorage, prefix))
  const database = indexedDB
  installProperty(
    'indexedDB',
    new Proxy(database, {
      get(target, property) {
        if (property === 'open') {
          return (name: string, version?: number) =>
            version === undefined
              ? target.open(`${prefix}${name}`)
              : target.open(`${prefix}${name}`, version)
        }
        if (property === 'deleteDatabase') {
          return (name: string) => target.deleteDatabase(`${prefix}${name}`)
        }
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  )
}
