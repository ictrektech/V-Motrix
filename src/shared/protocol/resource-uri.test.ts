import { describe, expect, it } from 'vitest'
import {
  decodeThunderUri,
  isDirectResourceUri,
  isDownloadableResourceUri,
  isEd2kUri,
  isFtpFamilyUri,
  isMagnetUri,
  normalizeResourceUriLine,
  splitResourceUriLines,
} from './resource-uri'

function thunder(inner: string): string {
  return `thunder://${Buffer.from(`AA${inner}ZZ`, 'utf8')
    .toString('base64')
    .replace(/=+$/u, '')}`
}

describe('resource-uri helpers', () => {
  it('wraps bare BitTorrent info hashes as magnet links', () => {
    const hash = 'a'.repeat(40)
    expect(normalizeResourceUriLine(hash)).toBe(`magnet:?xt=urn:btih:${hash}`)
    expect(isMagnetUri(normalizeResourceUriLine(hash))).toBe(true)
  })

  it('decodes thunder links to the underlying downloadable URI', () => {
    const url = 'https://example.com/file.zip'
    expect(decodeThunderUri(thunder(url))).toBe(url)
    expect(normalizeResourceUriLine(thunder(url))).toBe(url)
  })

  it('rejects malformed thunder payloads', () => {
    expect(decodeThunderUri('thunder://not-base64')).toBeNull()
    expect(decodeThunderUri('thunder://QUFmaWxlOlpaw')).toBeNull()
    expect(isDownloadableResourceUri('thunder://not-base64')).toBe(false)
  })

  it('accepts Motrix Next direct protocols supported by the current engine', () => {
    expect(isDirectResourceUri('https://example.com/a')).toBe(true)
    expect(isDirectResourceUri('ftp://example.com/a')).toBe(true)
    expect(isDirectResourceUri('sftp://example.com/a')).toBe(true)
  })

  it('recognizes ED2K links without enabling them on the current engine', () => {
    expect(
      isEd2kUri('ed2k://|file|ubuntu.iso|1|0123456789abcdef0123456789abcdef|/')
    ).toBe(true)
    expect(
      isDirectResourceUri(
        'ed2k://|file|ubuntu.iso|1|0123456789abcdef0123456789abcdef|/'
      )
    ).toBe(false)
  })

  it('classifies downloadable lines after normalization', () => {
    const hash = 'b'.repeat(40)
    expect(isDownloadableResourceUri(thunder('ftp://example.com/a'))).toBe(true)
    expect(
      isFtpFamilyUri(normalizeResourceUriLine('sftp://example.com/a'))
    ).toBe(true)
    expect(splitResourceUriLines(`${hash}\n\nhttps://example.com/a`)).toEqual([
      `magnet:?xt=urn:btih:${hash}`,
      'https://example.com/a',
    ])
  })
})
