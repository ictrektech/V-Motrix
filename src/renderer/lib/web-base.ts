export function resolveWebBase(
  baseUrl = import.meta.env.BASE_URL,
  href = globalThis.location?.href ?? 'http://localhost/'
): string {
  return new URL(baseUrl || '/', href).toString().replace(/\/$/, '')
}
