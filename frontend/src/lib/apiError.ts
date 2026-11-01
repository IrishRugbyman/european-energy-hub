// Turn a failed fetch Response body into a short message. FastAPI errors arrive as
// {"detail": "text"} (HTTPException) or {"detail": [{loc, msg}, ...]} (422 validation).
export function errorMessageFromBody(status: number, bodyText: string): string {
  let detail: unknown
  try {
    detail = (JSON.parse(bodyText) as { detail?: unknown }).detail
  } catch {
    detail = undefined
  }
  if (typeof detail === 'string' && detail) return `${status}: ${detail}`
  if (Array.isArray(detail) && detail.length > 0) {
    const parts = detail.map((d) => {
      const item = d as { loc?: unknown[]; msg?: string }
      const field = Array.isArray(item.loc) ? item.loc.filter((x) => x !== 'body').join('.') : ''
      return field ? `${field}: ${item.msg ?? 'invalid'}` : (item.msg ?? 'invalid')
    })
    return `${status}: ${parts.join('; ')}`
  }
  return bodyText ? `${status}: ${bodyText.slice(0, 200)}` : `${status}`
}
