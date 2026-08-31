import { ElectronTransport } from './electron'
import { HttpWsTransport } from './http-ws'
import type { Transport } from './types'

function createTransport(): Transport {
  if (__MOTRIX_TARGET__ === 'electron') return new ElectronTransport()
  const origin = globalThis.location?.origin ?? ''
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '')
  return new HttpWsTransport(`${origin}${basePath}`)
}

export const transport: Transport = createTransport()
export type { Transport } from './types'
