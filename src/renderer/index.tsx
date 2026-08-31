import {
  bootstrapVosSession,
  installVosStoragePartition,
} from '@renderer/lib/vos-auth'

async function bootstrap(): Promise<void> {
  const container = document.getElementById('root')
  if (!container) throw new Error('Root element not found')

  if (__MOTRIX_TARGET__ === 'web') {
    const vosUser = await bootstrapVosSession()
    if (vosUser) installVosStoragePartition(vosUser.namespace)
  }

  const { startRenderer } = await import('./app')
  await startRenderer(container)
}

void bootstrap()
