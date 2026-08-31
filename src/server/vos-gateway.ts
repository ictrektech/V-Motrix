import { type ChildProcess, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket, { type RawData, WebSocketServer } from 'ws'
import { rewritePaths, userFromPayload, type VosUser } from './vos-isolation'

const PORT = parsePort(process.env.PORT, 8080)
const DATA_ROOT = path.resolve(process.env.VOS_MOTRIX_DATA_ROOT || '/data')
const DOWNLOAD_ROOT = path.resolve(
  process.env.VOS_MOTRIX_DOWNLOAD_ROOT || '/downloads'
)
const RENDERER_ROOT = path.resolve(
  process.env.MOTRIX_RENDERER_DIR ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../renderer-web')
)
const USERINFO_URL =
  process.env.VOS_OIDC_USERINFO_URL?.trim() ||
  'http://172.17.0.1:8105/v1000/oauth2/userinfo'
const CLIENT_ID =
  process.env.VOS_OIDC_CLIENT_ID?.trim() || 'com.ictrek.v-motrix'
const OIDC_SCOPE = process.env.VOS_OIDC_SCOPE?.trim() || 'openid profile email'
const PUBLIC_BASE_PATH = normalizeBasePath(
  process.env.VOS_PUBLIC_BASE_PATH || '/'
)
const COOKIE_NAME = 'v_motrix_session'
const SESSION_TTL_MS = 12 * 60 * 60_000
const MAX_AUTH_BODY_BYTES = 64 * 1024
const MAX_JSON_PROXY_BYTES = 16 * 1024 * 1024
const VIRTUAL_DOWNLOAD_ROOT = '/downloads'
const serverEntry = fileURLToPath(new URL('./index.mjs', import.meta.url))

interface ChildRuntime {
  readonly child: ChildProcess
  readonly port: number
  readonly operatorToken: string
  readonly downloadRoot: string
}

interface SessionRecord {
  readonly user: VosUser
  expiresAt: number
}

const sessions = new Map<string, SessionRecord>()
const children = new Map<string, Promise<ChildRuntime>>()
const websocketServer = new WebSocketServer({ noServer: true })

function parsePort(value: string | undefined, fallback: number): number {
  const port = value?.trim() ? Number(value) : fallback
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535')
  }
  return port
}

function normalizeBasePath(value: string): string {
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`
  if (withLeadingSlash === '/') return '/'
  return withLeadingSlash.replace(/\/+$/, '')
}

function stripPublicBasePath(pathname: string): string {
  if (PUBLIC_BASE_PATH === '/') return pathname
  if (pathname === PUBLIC_BASE_PATH) return '/'
  const prefix = `${PUBLIC_BASE_PATH}/`
  if (!pathname.startsWith(prefix)) return pathname
  return pathname.slice(PUBLIC_BASE_PATH.length) || '/'
}

function json(
  response: ServerResponse,
  status: number,
  value: unknown,
  headers: Record<string, string> = {}
): void {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  })
  response.end(body)
}

async function readBody(
  request: IncomingMessage,
  limit: number
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > limit) throw new Error('request body is too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

async function verifyAccessToken(accessToken: string): Promise<VosUser> {
  const response = await fetch(USERINFO_URL, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) throw new Error(`VOS userinfo failed (${response.status})`)
  return userFromPayload(await response.json())
}

function parseCookies(header: string | undefined): Map<string, string> {
  const result = new Map<string, string>()
  for (const part of (header ?? '').split(';')) {
    const separator = part.indexOf('=')
    if (separator <= 0) continue
    const key = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    try {
      result.set(key, decodeURIComponent(value))
    } catch {
      // Ignore malformed cookies instead of weakening the auth boundary.
    }
  }
  return result
}

function sessionFor(request: IncomingMessage): SessionRecord | null {
  const token = parseCookies(request.headers.cookie).get(COOKIE_NAME)
  if (!token) return null
  const found = sessions.get(token)
  if (!found) return null
  if (found.expiresAt <= Date.now()) {
    sessions.delete(token)
    return null
  }
  found.expiresAt = Date.now() + SESSION_TTL_MS
  return found
}

function requestIsSecure(request: IncomingMessage): boolean {
  const forwarded = request.headers['x-forwarded-proto']
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded
  return value?.split(',')[0]?.trim().toLowerCase() === 'https'
}

function sessionCookie(
  request: IncomingMessage,
  token: string,
  maxAgeSeconds: number
): string {
  const flags = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Path=${PUBLIC_BASE_PATH}`,
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (requestIsSecure(request)) flags.push('Secure')
  return flags.join('; ')
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  if (!origin) return false
  try {
    return new URL(origin).host === request.headers.host
  } catch {
    return false
  }
}

function userRoot(user: VosUser): string {
  return path.join(DATA_ROOT, 'users', user.namespace)
}

function userDownloadRoot(user: VosUser): string {
  return path.join(DOWNLOAD_ROOT, 'users', user.namespace, 'downloads')
}

async function persistIdentity(user: VosUser): Promise<void> {
  const root = userRoot(user)
  await mkdir(root, { recursive: true, mode: 0o700 })
  await writeFile(
    path.join(root, 'identity.json'),
    JSON.stringify(
      {
        version: 1,
        provider: 'vos-oidc',
        subject: user.subject,
        username: user.username,
      },
      null,
      2
    ),
    { mode: 0o600 }
  )
}

function readyMessage(value: unknown): value is {
  type: 'motrix-server-ready'
  port: number
} {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    record.type === 'motrix-server-ready' &&
    typeof record.port === 'number' &&
    Number.isInteger(record.port) &&
    record.port > 0
  )
}

async function startChild(user: VosUser): Promise<ChildRuntime> {
  const root = userRoot(user)
  const appData = path.join(root, 'app')
  const downloads = userDownloadRoot(user)
  const home = path.join(root, 'home')
  const temp = path.join(root, 'tmp')
  await Promise.all(
    [appData, home, temp].map((directory) =>
      mkdir(directory, { recursive: true, mode: 0o700 })
    )
  )
  await mkdir(downloads, { recursive: true, mode: 0o755 })
  const operatorToken = randomBytes(32).toString('base64url')
  const child = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      HOME: home,
      PORT: '0',
      MOTRIX_DATA_DIR: appData,
      MOTRIX_TEMP_DIR: temp,
      MOTRIX_PLUGIN_DIR: path.join(appData, 'plugins'),
      MOTRIX_DEFAULT_SAVE_DIR: downloads,
      MOTRIX_ALLOWED_SAVE_DIRS: downloads,
      MOTRIX_OPERATOR_TOKEN: operatorToken,
      MOTRIX_MDXP_HOST: '127.0.0.1',
      MOTRIX_MDXP_PORT: '0',
    },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  })

  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('user runtime did not become ready in time'))
    }, 60_000)
    const cleanup = () => clearTimeout(timer)
    child.once('error', (error) => {
      cleanup()
      reject(error)
    })
    child.once('exit', (code, signal) => {
      cleanup()
      reject(
        new Error(
          `user runtime exited before ready (code=${code}, signal=${signal})`
        )
      )
    })
    child.on('message', (message) => {
      if (!readyMessage(message)) return
      cleanup()
      resolve(message.port)
    })
  })

  child.once('exit', () => {
    children.delete(user.namespace)
  })
  return { child, port, operatorToken, downloadRoot: downloads }
}

function childFor(user: VosUser): Promise<ChildRuntime> {
  const existing = children.get(user.namespace)
  if (existing) return existing
  const pending = startChild(user).catch((error) => {
    children.delete(user.namespace)
    throw error
  })
  children.set(user.namespace, pending)
  return pending
}

function rewriteJsonBuffer(buffer: Buffer, from: string, to: string): Buffer {
  const parsed: unknown = JSON.parse(buffer.toString('utf8') || 'null')
  return Buffer.from(JSON.stringify(rewritePaths(parsed, from, to)))
}

function contentTypeIsJson(headers: IncomingHttpHeaders): boolean {
  const value = headers['content-type']
  const contentType = Array.isArray(value) ? value[0] : value
  return contentType?.toLowerCase().includes('application/json') === true
}

function proxyHeaders(
  source: IncomingHttpHeaders,
  operatorToken: string
): IncomingHttpHeaders {
  const headers = { ...source }
  delete headers.connection
  delete headers.cookie
  delete headers.host
  delete headers.origin
  delete headers['content-length']
  delete headers['transfer-encoding']
  headers.authorization = `Bearer ${operatorToken}`
  return headers
}

async function proxyHttp(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ChildRuntime,
  upstreamPath: string
): Promise<void> {
  const isJson = contentTypeIsJson(request.headers)
  const body = isJson
    ? rewriteJsonBuffer(
        await readBody(request, MAX_JSON_PROXY_BYTES),
        VIRTUAL_DOWNLOAD_ROOT,
        runtime.downloadRoot
      )
    : null
  const headers = proxyHeaders(request.headers, runtime.operatorToken)
  if (body) headers['content-length'] = String(body.length)

  await new Promise<void>((resolve) => {
    const upstream = http.request(
      {
        host: '127.0.0.1',
        port: runtime.port,
        method: request.method,
        path: upstreamPath,
        headers,
      },
      (upstreamResponse) => {
        const responseHeaders = { ...upstreamResponse.headers }
        delete responseHeaders.connection
        delete responseHeaders['content-length']
        delete responseHeaders['set-cookie']
        delete responseHeaders['transfer-encoding']
        if (contentTypeIsJson(upstreamResponse.headers)) {
          void readBody(upstreamResponse, MAX_JSON_PROXY_BYTES)
            .then((raw) =>
              rewriteJsonBuffer(
                raw,
                runtime.downloadRoot,
                VIRTUAL_DOWNLOAD_ROOT
              )
            )
            .then((mapped) => {
              responseHeaders['content-length'] = String(mapped.length)
              response.writeHead(
                upstreamResponse.statusCode || 502,
                responseHeaders
              )
              response.end(mapped)
              resolve()
            })
            .catch((error: unknown) => {
              json(response, 502, {
                error:
                  error instanceof Error ? error.message : 'invalid response',
              })
              resolve()
            })
          return
        }
        response.writeHead(upstreamResponse.statusCode || 502, responseHeaders)
        upstreamResponse.pipe(response)
        upstreamResponse.once('end', resolve)
      }
    )
    upstream.once('error', (error) => {
      json(response, 502, {
        error: `user runtime unavailable: ${error.message}`,
      })
      resolve()
    })
    if (body) upstream.end(body)
    else request.pipe(upstream)
  })
}

const mimeTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

async function serveStatic(
  _request: IncomingMessage,
  response: ServerResponse,
  pathname: string
): Promise<void> {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    response.writeHead(400)
    response.end('Bad request')
    return
  }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '')
  const candidate = path.resolve(RENDERER_ROOT, relative)
  const insideRenderer =
    candidate === RENDERER_ROOT ||
    candidate.startsWith(`${RENDERER_ROOT}${path.sep}`)
  const selected =
    insideRenderer &&
    (await stat(candidate).then(
      (info) => info.isFile(),
      () => false
    ))
      ? candidate
      : path.join(RENDERER_ROOT, 'index.html')
  try {
    const content = await readFile(selected)
    response.writeHead(200, {
      'content-length': content.length,
      'content-type':
        mimeTypes[path.extname(selected)] || 'application/octet-stream',
    })
    response.end(content)
  } catch {
    response.writeHead(404)
    response.end('Not found')
  }
}

async function handleAuth(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string
): Promise<boolean> {
  if (pathname === '/api/vos/auth/session' && request.method === 'GET') {
    const found = sessionFor(request)
    json(response, 200, {
      enabled: true,
      authenticated: Boolean(found),
      ...(found
        ? {
            user: {
              username: found.user.username,
              namespace: found.user.namespace,
            },
          }
        : {}),
      clientId: CLIENT_ID,
      scope: OIDC_SCOPE,
    })
    return true
  }
  if (pathname === '/api/vos/auth/login' && request.method === 'POST') {
    if (!sameOrigin(request)) {
      json(response, 403, { error: 'invalid request origin' })
      return true
    }
    try {
      const body = JSON.parse(
        (await readBody(request, MAX_AUTH_BODY_BYTES)).toString('utf8') || '{}'
      ) as Record<string, unknown>
      const accessToken =
        typeof body.access_token === 'string' ? body.access_token.trim() : ''
      if (!accessToken) throw new Error('access_token is required')
      const user = await verifyAccessToken(accessToken)
      await persistIdentity(user)
      await childFor(user)
      const previousToken = parseCookies(request.headers.cookie).get(
        COOKIE_NAME
      )
      if (previousToken) sessions.delete(previousToken)
      const token = randomBytes(32).toString('base64url')
      sessions.set(token, { user, expiresAt: Date.now() + SESSION_TTL_MS })
      json(
        response,
        200,
        {
          authenticated: true,
          user: { username: user.username, namespace: user.namespace },
        },
        {
          'set-cookie': sessionCookie(
            request,
            token,
            Math.floor(SESSION_TTL_MS / 1000)
          ),
        }
      )
    } catch (error) {
      json(response, 401, {
        error: error instanceof Error ? error.message : 'VOS login failed',
      })
    }
    return true
  }
  if (pathname === '/api/vos/auth/logout' && request.method === 'POST') {
    if (!sameOrigin(request)) {
      json(response, 403, { error: 'invalid request origin' })
      return true
    }
    const token = parseCookies(request.headers.cookie).get(COOKIE_NAME)
    if (token) sessions.delete(token)
    json(
      response,
      200,
      { authenticated: false },
      { 'set-cookie': sessionCookie(request, '', 0) }
    )
    return true
  }
  return false
}

const server = http.createServer((request, response) => {
  void (async () => {
    const url = new URL(
      request.url || '/',
      `http://${request.headers.host || 'localhost'}`
    )
    const pathname = stripPublicBasePath(url.pathname)
    const upstreamPath = `${pathname}${url.search}`
    if (pathname === '/healthz') {
      json(response, 200, { ok: true })
      return
    }
    if (await handleAuth(request, response, pathname)) return
    const protectedPath =
      pathname.startsWith('/rpc/') || pathname.startsWith('/api/')
    if (!protectedPath && request.method === 'GET') {
      await serveStatic(request, response, pathname)
      return
    }
    const found = sessionFor(request)
    if (!found) {
      json(response, 401, { error: 'VOS authentication required' })
      return
    }
    await proxyHttp(request, response, await childFor(found.user), upstreamPath)
  })().catch((error: unknown) => {
    if (response.headersSent) {
      response.destroy(error instanceof Error ? error : undefined)
      return
    }
    json(response, 500, {
      error: error instanceof Error ? error.message : 'internal error',
    })
  })
})

function mapWebSocketData(
  data: RawData,
  from: string,
  to: string
): string | Buffer {
  const buffer = Buffer.isBuffer(data)
    ? data
    : Array.isArray(data)
      ? Buffer.concat(data)
      : Buffer.from(data)
  try {
    return rewriteJsonBuffer(buffer, from, to)
  } catch {
    return buffer
  }
}

server.on('upgrade', (request, socket, head) => {
  void (async () => {
    const url = new URL(
      request.url || '/',
      `http://${request.headers.host || 'localhost'}`
    )
    const pathname = stripPublicBasePath(url.pathname)
    if (pathname !== '/rpc/events') {
      socket.destroy()
      return
    }
    const found = sessionFor(request)
    if (!found) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const runtime = await childFor(found.user)
    websocketServer.handleUpgrade(request, socket, head, (client) => {
      const upstream = new WebSocket(
        `ws://127.0.0.1:${runtime.port}/rpc/events`,
        { headers: { authorization: `Bearer ${runtime.operatorToken}` } }
      )
      const pending: Array<{ data: RawData; binary: boolean }> = []
      client.on('message', (data, binary) => {
        if (upstream.readyState !== WebSocket.OPEN) {
          pending.push({ data, binary })
          return
        }
        upstream.send(
          mapWebSocketData(data, VIRTUAL_DOWNLOAD_ROOT, runtime.downloadRoot),
          { binary }
        )
      })
      upstream.on('open', () => {
        for (const message of pending.splice(0)) {
          upstream.send(
            mapWebSocketData(
              message.data,
              VIRTUAL_DOWNLOAD_ROOT,
              runtime.downloadRoot
            ),
            { binary: message.binary }
          )
        }
      })
      upstream.on('message', (data, binary) => {
        if (client.readyState !== WebSocket.OPEN) return
        client.send(
          mapWebSocketData(data, runtime.downloadRoot, VIRTUAL_DOWNLOAD_ROOT),
          { binary }
        )
      })
      const closeBoth = () => {
        if (client.readyState === WebSocket.OPEN) client.close()
        if (upstream.readyState === WebSocket.OPEN) upstream.close()
      }
      client.on('close', closeBoth)
      client.on('error', closeBoth)
      upstream.on('close', closeBoth)
      upstream.on('error', closeBoth)
    })
  })().catch(() => socket.destroy())
})

async function shutdown(): Promise<void> {
  server.close()
  const runtimes = await Promise.allSettled(children.values())
  for (const result of runtimes) {
    if (result.status === 'fulfilled') result.value.child.kill('SIGTERM')
  }
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())

await access(RENDERER_ROOT)
await mkdir(DATA_ROOT, { recursive: true, mode: 0o700 })
server.listen(PORT, '0.0.0.0', () => {
  process.stdout.write(`V-Motrix VOS gateway listening on 0.0.0.0:${PORT}\n`)
})
