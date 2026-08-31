import {
  isDownloadableResourceUri,
  normalizeResourceUriLine,
} from '@shared/protocol/resource-uri'
import type { InterpretResult, UrlInputInterpreter } from './types'

export interface ParsedLine {
  line: number
  url: string
  valid: boolean
}

export function parseUrlLines(text: string): ParsedLine[] {
  const out: ParsedLine[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const url = normalizeResourceUriLine(lines[i])
    if (url === '') continue
    out.push({ line: i, url, valid: isDownloadableResourceUri(url) })
  }
  return out
}

export const multilineUrlInterpreter: UrlInputInterpreter = {
  id: 'builtin:multiline-url',
  name: 'Multi-line URL',
  priority: 1000,
  tryInterpret(rawText): InterpretResult | null {
    const parsed = parseUrlLines(rawText)
    const validUrls = parsed.filter((p) => p.valid).map((p) => p.url)
    if (validUrls.length === 0) return null
    return { urls: validUrls }
  },
}
