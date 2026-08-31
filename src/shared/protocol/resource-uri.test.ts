import { describe, expect, it } from 'vitest'
import {
  decodeThunderUri,
  ed2kFileName,
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

  it('normalizes magnet scheme variants before download routing', () => {
    const magnet = `magnet:?xt=urn:btih:${'a'.repeat(40)}`
    expect(normalizeResourceUriLine(magnet)).toBe(magnet)
    expect(
      normalizeResourceUriLine(magnet.replace('magnet:?', 'magnet://'))
    ).toBe(magnet)
    expect(
      normalizeResourceUriLine(magnet.replace('magnet:?', 'magnet://?'))
    ).toBe(magnet)
    expect(
      isDownloadableResourceUri(magnet.replace('magnet:?', 'magnet://'))
    ).toBe(true)
  })

  it('decodes thunder links to the underlying downloadable URI', () => {
    const url = 'https://example.com/file.zip'
    expect(decodeThunderUri(thunder(url))).toBe(url)
    expect(normalizeResourceUriLine(thunder(url))).toBe(url)
  })

  it('decodes thunder links to normalized magnet and ED2K resources', () => {
    const magnet = `magnet:?xt=urn:btih:${'b'.repeat(40)}`
    const ed2k = 'ed2k://|file|ubuntu.iso|1|0123456789abcdef0123456789abcdef|/'

    expect(
      decodeThunderUri(thunder(magnet.replace('magnet:?', 'magnet://')))
    ).toBe(magnet)
    expect(normalizeResourceUriLine(thunder(ed2k))).toBe(ed2k)
  })

  it('rejects malformed thunder payloads', () => {
    expect(decodeThunderUri('thunder://not-base64')).toBeNull()
    expect(decodeThunderUri('thunder://QUFmaWxlOlpaw')).toBeNull()
    expect(isDownloadableResourceUri('thunder://not-base64')).toBe(false)
  })

  it('accepts Motrix Next direct protocols supported by the current engine', () => {
    expect(isDirectResourceUri('https://example.com/a')).toBe(true)
    expect(isDirectResourceUri('sftp://example.com/a')).toBe(true)
    expect(
      isDirectResourceUri(
        'ed2k://|file|ubuntu.iso|1|0123456789abcdef0123456789abcdef|/'
      )
    ).toBe(true)
  })

  it('recognizes ED2K file links and extracts their filename', () => {
    expect(
      isEd2kUri('ed2k://|file|ubuntu.iso|1|0123456789abcdef0123456789abcdef|/')
    ).toBe(true)
    expect(
      ed2kFileName(
        'ed2k://|file|ubuntu%2024.04.iso|1|0123456789abcdef0123456789abcdef|/'
      )
    ).toBe('ubuntu 24.04.iso')
    expect(isEd2kUri('ed2k://|server|example|4661|/')).toBe(false)
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
