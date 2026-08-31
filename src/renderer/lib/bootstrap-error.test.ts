import '@testing-library/jest-dom/vitest'
import { describe, expect, it } from 'vitest'
import { renderBootstrapError } from './bootstrap-error'

describe('renderBootstrapError', () => {
  it('renders a diagnostic instead of leaving the application blank', () => {
    const root = document.createElement('div')

    renderBootstrapError(root, new Error('VOS OIDC failed'))

    expect(root).toHaveTextContent('V-Motrix could not start')
    expect(root).toHaveTextContent('VOS OIDC failed')
  })
})
