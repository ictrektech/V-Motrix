import { resolveSupportedLocale } from '@shared/constants/locales'
import { i18n } from './i18n'

export function renderBootstrapError(
  container: HTMLElement,
  error: unknown
): void {
  const t = i18n.getFixedT(resolveSupportedLocale(navigator.language))
  const message =
    error instanceof Error && error.message
      ? error.message
      : t('bootstrapError.unknownDetail')

  const panel = document.createElement('main')
  panel.setAttribute('role', 'alert')
  Object.assign(panel.style, {
    boxSizing: 'border-box',
    display: 'grid',
    placeContent: 'center',
    gap: '12px',
    minHeight: '100vh',
    padding: '32px',
    color: '#27272a',
    background: '#fafafa',
    fontFamily: 'system-ui, sans-serif',
    textAlign: 'center',
  })

  const title = document.createElement('h1')
  title.textContent = t('bootstrapError.title')
  Object.assign(title.style, { margin: '0', fontSize: '20px' })

  const detail = document.createElement('p')
  detail.textContent = t('bootstrapError.detail', { message })
  Object.assign(detail.style, {
    margin: '0',
    color: '#71717a',
    fontSize: '14px',
  })

  const retry = document.createElement('button')
  retry.type = 'button'
  retry.textContent = t('bootstrapError.retry')
  Object.assign(retry.style, {
    justifySelf: 'center',
    padding: '8px 16px',
    border: '0',
    borderRadius: '8px',
    color: '#fff',
    background: '#2563eb',
    cursor: 'pointer',
  })
  retry.addEventListener('click', () => window.location.reload())

  panel.append(title, detail, retry)
  container.replaceChildren(panel)
}
