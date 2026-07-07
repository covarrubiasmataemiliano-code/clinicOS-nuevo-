// ============================================================
// setup-clinic-agent.mjs — activa el agente de Atención (Fase 2) para
// la cuenta demo de clinicOS.
//
// Qué hace (idempotente):
//   1. Cifra tu API key de Anthropic con el MISMO esquema AES-256-GCM
//      de la app (ENCRYPTION_KEY de .env.local) y la guarda en
//      `ai_configs` con provider=anthropic, is_active=true,
//      auto_reply_enabled=true y clinical_agent_enabled=true.
//   2. Crea un `whatsapp_config` dummy para la cuenta: en dry-run de
//      Zernio el envío saliente corta a Zernio ANTES de usar el token
//      de Meta, pero el motor de envío exige que exista la fila (y que
//      el token se pueda descifrar), así que sembramos una placeholder.
//
// Requisitos:
//   * La migración 032 debe estar aplicada (columna clinical_agent_enabled
//     + tipos de notificación). Ver COMO-CORRER.md.
//   * Node 22+ (igual que el seed): @supabase/supabase-js lo pide.
//
// Proveedor: usa OPENAI_API_KEY (modelo por defecto o4-mini) o
// ANTHROPIC_API_KEY (por defecto claude-sonnet-5), leídas de .env.local
// para NO exponer la key en la línea de comandos. Prioriza OpenAI si
// ambas están presentes; override del proveedor/modelo con
// AGENT_PROVIDER / AGENT_MODEL.
//
// Uso:
//   ~/.nvm/versions/node/v22.23.1/bin/node scripts/setup-clinic-agent.mjs
//
// Opcionales (env): DEMO_EMAIL, AGENT_PROVIDER, AGENT_MODEL.
// ============================================================

import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

// --- Cargar .env.local a mano (mismo patrón que seed-demo.mjs) ---
const envFile = readFileSync(resolve(ROOT, '.env.local'), 'utf8')
const env = Object.fromEntries(
  envFile
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE = env.SUPABASE_SERVICE_ROLE_KEY
const ENCRYPTION_KEY = env.ENCRYPTION_KEY
const EMAIL = process.env.DEMO_EMAIL || 'covarrubiasmataemiliano@gmail.com'

const die = (m) => {
  console.error(`\x1b[31m✗ ${m}\x1b[0m`)
  process.exit(1)
}
const ok = (m) => console.log(`\x1b[32m✓ ${m}\x1b[0m`)
const info = (m) => console.log(`\x1b[36m▸ ${m}\x1b[0m`)

if (!SUPABASE_URL || !SERVICE_ROLE) die('Faltan credenciales de Supabase en .env.local')
if (!ENCRYPTION_KEY) die('Falta ENCRYPTION_KEY en .env.local')

// Resolver proveedor + key desde .env.local (nunca por CLI).
const OPENAI_KEY = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY
const ANTHROPIC_KEY = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
let PROVIDER = process.env.AGENT_PROVIDER
if (!PROVIDER) PROVIDER = OPENAI_KEY ? 'openai' : ANTHROPIC_KEY ? 'anthropic' : ''
const API_KEY = PROVIDER === 'openai' ? OPENAI_KEY : ANTHROPIC_KEY
const MODEL =
  process.env.AGENT_MODEL ||
  (PROVIDER === 'openai' ? 'o4-mini' : 'claude-sonnet-5')

if (!PROVIDER || !API_KEY) {
  die(
    'No encontré una API key en .env.local. Añade una línea:\n' +
      '  OPENAI_API_KEY=sk-proj-...     (usa modelo o4-mini)\n' +
      '  o  ANTHROPIC_API_KEY=sk-ant-... (usa claude-sonnet-5)\n' +
      'y vuelve a correr el script.',
  )
}

// --- Cifrado GCM idéntico a src/lib/whatsapp/encryption.ts ---
function encrypt(text) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), iv)
  let enc = cipher.update(text, 'utf8', 'hex')
  enc += cipher.final('hex')
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${enc}:${tag.toString('hex')}`
}

// Persona/negocio de la clínica demo. Se ANEXA al andamiaje fijo del
// agente (reglas de oro, embudo, escalación) — aquí solo va lo propio
// de esta clínica.
const CLINIC_CONTEXT = `Eres Sofía, la recepcionista virtual de la Clínica Demo clinicOS. La clínica ofrece valoraciones (presenciales y virtuales) y procedimientos de estética (como rinoplastia) y odontología (como limpieza dental profunda), siempre con valoración previa del doctor.
Tu meta es atender con calidez, resolver dudas y llevar al paciente a agendar su valoración. Consulta SIEMPRE el catálogo para precios y anticipos (los tienes en herramientas), y ofrece la valoración presencial o virtual según lo que le acomode al paciente.
Tono: cercano, profesional, mexicano. Preséntate como Sofía del equipo de la clínica.`

const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function main() {
  // 1. Resolver la cuenta demo por el email del dueño.
  info(`Buscando la cuenta de ${EMAIL}…`)
  const { data: profiles, error: pErr } = await db
    .from('profiles')
    .select('account_id, user_id, account_role')
    .eq('email', EMAIL)
    .eq('account_role', 'owner')
    .limit(1)
  if (pErr) die(`No pude leer profiles: ${pErr.message}`)
  const profile = profiles?.[0]
  if (!profile) die(`No encontré un perfil owner con email ${EMAIL}. ¿Corriste el seed?`)
  const { account_id: accountId, user_id: userId } = profile
  ok(`Cuenta ${accountId}`)

  // 2. Upsert de ai_configs (una fila por cuenta; account_id es UNIQUE).
  info('Activando el agente de Atención en ai_configs…')
  const { error: aiErr } = await db.from('ai_configs').upsert(
    {
      account_id: accountId,
      created_by: userId,
      provider: PROVIDER,
      model: MODEL,
      api_key: encrypt(API_KEY),
      system_prompt: CLINIC_CONTEXT,
      is_active: true,
      auto_reply_enabled: true,
      auto_reply_max_per_conversation: 8,
      clinical_agent_enabled: true,
    },
    { onConflict: 'account_id' },
  )
  if (aiErr) {
    if (/clinical_agent_enabled/.test(aiErr.message)) {
      die(
        'La columna clinical_agent_enabled no existe todavía — aplica la migración 032 primero (ver COMO-CORRER.md).',
      )
    }
    die(`No pude guardar ai_configs: ${aiErr.message}`)
  }
  ok(`Agente activo (provider=${PROVIDER}, model=${MODEL})`)

  // 3. whatsapp_config dummy para que el envío en dry-run de Zernio no
  //    falle por "WhatsApp not configured". Zernio corta antes de usar
  //    estos valores; solo importa que la fila exista y el token se
  //    pueda descifrar.
  info('Sembrando whatsapp_config placeholder (dry-run Zernio)…')
  const { error: waErr } = await db.from('whatsapp_config').upsert(
    {
      user_id: userId,
      account_id: accountId,
      phone_number_id: 'zernio-dry-run',
      access_token: encrypt('zernio-dry-run-token'),
      status: 'connected',
    },
    // La migración 017 hizo account_id la clave única (una config de
    // WhatsApp por cuenta), reemplazando el UNIQUE(user_id) original.
    { onConflict: 'account_id' },
  )
  if (waErr) die(`No pude sembrar whatsapp_config: ${waErr.message}`)
  ok('whatsapp_config listo')

  console.log(`
\x1b[32m✓ Agente de Atención listo.\x1b[0m
  El agente ya responde los mensajes entrantes de la conversación demo
  usando herramientas (catálogo, disponibilidad, agendar, prevalidar
  anticipo, clasificar lead, escalar). Recuerda:
    • Todo lo agenda/prevalida en 'pendiente' — tú confirmas en el panel.
    • En dry-run (ZERNIO_DRY_RUN=true) las respuestas se guardan en la
      conversación pero NO salen por WhatsApp real.

  Para probarlo sin WhatsApp real: usa el Playground de IA, o inserta un
  mensaje entrante de prueba en la conversación demo. Con credenciales
  reales de Zernio, contesta directo en WhatsApp.
`)
}

main().catch((e) => die(e.message))
