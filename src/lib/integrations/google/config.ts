// ============================================================
// clinicOS — configuración de la integración con Google.
//
// La integración habla con las APIs REST de Google por `fetch` (sin el
// SDK `googleapis`): más liviano y en línea con cómo el resto de la app
// llama servicios externos (WhatsApp, webhooks). Aquí viven los
// endpoints, los scopes y los lectores de variables de entorno.
//
// Una sola conexión por cuenta (ver migración 045). Scopes mínimos:
//   * calendar        — crear el calendario "Clínica" y sus eventos.
//   * drive.file      — solo los archivos que crea la app (docs de
//                       pacientes, respaldos); NO ve el resto del Drive.
//   * userinfo.email  — para guardar con qué correo quedó conectada.
// ============================================================

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
export const GOOGLE_USERINFO_URL =
  'https://openidconnect.googleapis.com/v1/userinfo'
export const GOOGLE_CALENDAR_BASE =
  'https://www.googleapis.com/calendar/v3'
export const GOOGLE_DRIVE_BASE = 'https://www.googleapis.com/drive/v3'
export const GOOGLE_DRIVE_UPLOAD_BASE =
  'https://www.googleapis.com/upload/drive/v3'

/** Scopes solicitados en el consentimiento. */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
]

/** Nombre del calendario dedicado que se crea al conectar. */
export const CLINIC_CALENDAR_NAME = 'Clínica — clinicOS'

/** Nombre de la carpeta raíz de Drive que agrupa todo lo de la app. */
export const DRIVE_ROOT_FOLDER_NAME = 'clinicOS'

/** Subcarpeta que agrupa las carpetas por paciente. */
export const DRIVE_PATIENTS_FOLDER_NAME = 'Pacientes'

export interface GoogleOAuthEnv {
  clientId: string
  clientSecret: string
  redirectUri: string
}

/**
 * Lee la config de OAuth de las variables de entorno. Lanza si falta
 * algo — así el `connect` falla temprano y claro en vez de mandar al
 * usuario a un consentimiento roto.
 *
 * `GOOGLE_OAUTH_REDIRECT_URI` debe apuntar EXACTO a
 * `<origin>/api/integrations/google/callback` y estar dado de alta en
 * la consola de Google Cloud.
 */
export function googleOAuthEnv(): GoogleOAuthEnv {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'Google OAuth no está configurado (faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_OAUTH_REDIRECT_URI).',
    )
  }
  return { clientId, clientSecret, redirectUri }
}

/** ¿Está configurada la integración de Google en este entorno? */
export function isGoogleConfigured(): boolean {
  return (
    !!process.env.GOOGLE_CLIENT_ID &&
    !!process.env.GOOGLE_CLIENT_SECRET &&
    !!process.env.GOOGLE_OAUTH_REDIRECT_URI
  )
}

/**
 * URL de vuelta a Settings → Integraciones con el resultado del flujo
 * (?google=ok|error&code=...). El origen sale de NEXT_PUBLIC_SITE_URL, o
 * se deriva del redirect_uri configurado.
 */
export function settingsResultUrl(kind: 'ok' | 'error', code: string): string {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ||
    process.env.GOOGLE_OAUTH_REDIRECT_URI?.replace(
      /\/api\/integrations\/google\/callback\/?$/,
      '',
    ) ||
    ''
  return `${base}/settings?tab=integrations&google=${kind}&code=${code}`
}
