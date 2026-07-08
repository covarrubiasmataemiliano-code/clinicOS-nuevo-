// ============================================================
// clinicOS — helper REST compartido para las APIs de Google.
//
// Añade el Bearer, un timeout corto y un manejo de error uniforme que
// preserva el status HTTP (para que el llamador distinga, p. ej., un 404
// "el evento ya no existe" de un 401 "token inválido").
// ============================================================

const GOOGLE_TIMEOUT_MS = 15_000

export class GoogleApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'GoogleApiError'
    this.status = status
  }
}

interface GoogleFetchInit {
  method?: string
  /** Cuerpo JSON (se serializa y se manda con Content-Type json). */
  json?: unknown
  /** Cuerpo crudo (para multipart de Drive); precede a `json`. */
  body?: BodyInit
  headers?: Record<string, string>
}

/**
 * Llama una API de Google y devuelve el JSON parseado. Lanza
 * `GoogleApiError` con el status en respuestas no-2xx. Un 204/empty
 * devuelve `null`.
 */
export async function googleFetch<T = unknown>(
  accessToken: string,
  url: string,
  init: GoogleFetchInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    ...(init.headers ?? {}),
  }
  let body = init.body
  if (init.json !== undefined && body === undefined) {
    body = JSON.stringify(init.json)
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers,
    body,
    signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
  })

  if (res.status === 204) return null as T
  const text = await res.text()
  const data = text ? safeParse(text) : null

  if (!res.ok) {
    const message =
      (data as { error?: { message?: string } } | null)?.error?.message ||
      `Google API ${res.status}`
    throw new GoogleApiError(res.status, message)
  }
  return data as T
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
