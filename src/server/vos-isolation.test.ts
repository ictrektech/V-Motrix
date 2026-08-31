import { describe, expect, it } from 'vitest'
import { rewritePaths, userFromPayload } from './vos-isolation'

describe('VOS user isolation', () => {
  it('derives stable, opaque, distinct namespaces from immutable subjects', () => {
    const alice = userFromPayload({
      sub: 'user-a',
      preferred_username: 'alice',
    })
    const aliceAgain = userFromPayload({
      sub: 'user-a',
      preferred_username: 'renamed-alice',
    })
    const bob = userFromPayload({
      sub: 'user-b',
      preferred_username: 'bob',
    })

    expect(alice.namespace).toMatch(/^[a-f0-9]{40}$/)
    expect(alice.namespace).toBe(aliceAgain.namespace)
    expect(alice.namespace).not.toBe(bob.namespace)
    expect(alice.namespace).not.toContain('alice')
  })

  it('maps only the current user download root to the public alias', () => {
    const aliceRoot = `/data/users/${'a'.repeat(40)}/downloads`
    const bobRoot = `/data/users/${'b'.repeat(40)}/downloads`
    const mapped = rewritePaths(
      {
        defaultSaveDir: aliceRoot,
        tasks: [{ saveDir: `${aliceRoot}/linux` }, { saveDir: bobRoot }],
      },
      aliceRoot,
      '/downloads'
    )

    expect(mapped).toEqual({
      defaultSaveDir: '/downloads',
      tasks: [{ saveDir: '/downloads/linux' }, { saveDir: bobRoot }],
    })
  })

  it('maps the public alias back only inside the current user root', () => {
    const root = `/data/users/${'a'.repeat(40)}/downloads`
    expect(
      rewritePaths(
        ['/downloads', '/downloads/nested', '/downloads-other'],
        '/downloads',
        root
      )
    ).toEqual([root, `${root}/nested`, '/downloads-other'])
  })
})
