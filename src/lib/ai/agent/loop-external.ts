// ============================================================
// clinicOS — adaptador de arnés EXTERNO (OpenAI-compat, "brain-only").
//
// Para backends que corren SU PROPIO loop agéntico (OpenClaw, Hermes): no
// ejecutamos tools locales ni iteramos rondas. Mandamos el transcript a su
// endpoint OpenAI-compat `/chat/completions` (el gateway resuelve tools,
// memoria y persona de su lado) y tomamos el texto final.
//
// Contrato idéntico al de los loops nativos: devuelve
// RunClinicalAgentResult, con el mismo parseo del centinela de handoff, de
// modo que auto-reply.ts (guardrail, slot, envío) no distingue el backend.
//
// ⚠️ GAP DE DATOS (v1): el arnés externo NO escribe en el Supabase de
// wacrm — corre sus propias tools. Estos adaptadores son REDACTORES; para
// que sus acciones (agendar/cobrar) impacten los datos hace falta exponerle
// las tools de wacrm por su API pública (fase siguiente, no aquí).
// ============================================================

import { mergeConsecutive, providerHttpError, toNetworkError } from '../providers/shared'
import { aiRequestTimeoutMs } from '../defaults'
import { parseGeneration } from '../generate'
import type { RunClinicalAgentArgs, RunClinicalAgentResult } from './tools'

interface OpenAiChatResponse {
  choices?: { message?: { content?: string | null } }[]
}

/**
 * Atiende el turno delegando a un gateway agéntico externo OpenAI-compat.
 * `args.baseUrl` incluye el `/v1`; le anexamos `/chat/completions`.
 * Lanza AiError (red/HTTP) igual que los loops nativos — auto-reply.ts lo
 * captura y no rompe el 200 del webhook.
 */
export async function runExternalAgent(
  args: RunClinicalAgentArgs,
): Promise<RunClinicalAgentResult> {
  const base = (args.baseUrl ?? '').replace(/\/+$/, '')
  if (!base) {
    // Config incompleta: sin gateway no hay a quién preguntar. Tratamos el
    // turno como handoff (auto-reply.ts avisará al equipo) en vez de tronar.
    return { text: '', handoff: true, escalated: false, traces: [] }
  }
  const url = `${base}/chat/completions`
  const timeoutMs = aiRequestTimeoutMs()

  const messages = [
    { role: 'system' as const, content: args.systemPrompt },
    ...mergeConsecutive(args.messages).map((m) => ({
      role: m.role,
      content: m.content,
    })),
  ]

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(args.authToken ? { Authorization: `Bearer ${args.authToken}` } : {}),
      },
      body: JSON.stringify({ model: args.model, messages, stream: false }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }
  if (!res.ok) throw await providerHttpError(`AgentGateway(${args.backend})`, res)

  const data = (await res.json().catch(() => ({}))) as OpenAiChatResponse
  const content = data.choices?.[0]?.message?.content ?? ''

  console.log(
    `[external agent ${args.backend}] model=${args.model} chars=${String(content).length}`,
  )

  // Mismo parseo del centinela de handoff que los loops nativos. Sin
  // traces: el loop de tools corrió del lado del gateway, no del nuestro.
  const { text, handoff } = parseGeneration(String(content).trim())
  return { text, handoff, escalated: false, traces: [] }
}
