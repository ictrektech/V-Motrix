import { describe, expect, it } from 'vitest'
import { resolveWebBase } from './web-base'

describe('resolveWebBase', () => {
  it('resolves an absolute VOS base path against the current origin', () => {
    expect(
      resolveWebBase(
        '/app/com.ictrek.v-motrix/',
        'http://vos.example/#/app/com.ictrek.v-motrix/page'
      )
    ).toBe('http://vos.example/app/com.ictrek.v-motrix')
  })

  it('keeps relative web assets on the current VOS app path', () => {
    expect(
      resolveWebBase(
        './',
        'http://vos.example/app/com.ictrek.v-motrix/#/downloads'
      )
    ).toBe('http://vos.example/app/com.ictrek.v-motrix')
  })
})
