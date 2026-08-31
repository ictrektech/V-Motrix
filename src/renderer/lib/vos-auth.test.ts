import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootstrapVosSession } from './vos-auth'

describe('bootstrapVosSession', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete window.vos_platform
  })

  it('completes PKCE when WebCrypto subtle is unavailable on HTTP VOS', async () => {
    const browserCrypto = globalThis.crypto
    vi.stubGlobal('crypto', {
      getRandomValues: (value: Uint8Array<ArrayBuffer>) =>
        browserCrypto.getRandomValues(value),
    })

    const authorize = vi.fn(async (params: Record<string, unknown>) => ({
      code: 'authorization-code',
      state: String(params.state),
    }))
    const token = vi.fn(async () => ({ access_token: 'access-token' }))
    window.vos_platform = { api: { v1000: { oauth2: { authorize, token } } } }

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          enabled: true,
          clientId: 'com.ictrek.v-motrix',
          scope: 'openid profile email',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          user: { username: 'alice', namespace: 'a'.repeat(40) },
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    await expect(bootstrapVosSession()).resolves.toEqual({
      username: 'alice',
      namespace: 'a'.repeat(40),
    })
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        code_challenge_method: 'S256',
        code_challenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      })
    )
    expect(token).toHaveBeenCalledWith(
      expect.objectContaining({ code_verifier: expect.any(String) })
    )
  })
})
