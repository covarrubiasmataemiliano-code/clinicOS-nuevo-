// ============================================================
// clinicOS — puerto AgentHarness (hexagonal).
//
// Un solo contrato para "atender un turno": recibe el transcript + las
// tools + el contexto, devuelve la respuesta. Los adaptadores viven
// detrás:
//   - native   → los loops de tool-use in-app (loop.ts / loop-openai.ts).
//   - openclaw → gateway agéntico externo OpenAI-compat (loop-external.ts).
//   - hermes   → idem, otra base URL.
//
// El selector es `RunClinicalAgentArgs.backend` (default 'native'). Todo
// lo que rodea al turno (guardrail determinista, claim de slot, candado
// humano, buffer, envío) vive ARRIBA de este puerto, en auto-reply.ts —
// runTurn es una función pura "transcript + tools → reply".
// ============================================================

import type {
  RunClinicalAgentArgs,
  RunClinicalAgentResult,
} from './tools'

/** El puerto: cualquier arnés agéntico implementa esto. */
export interface AgentHarness {
  runTurn(args: RunClinicalAgentArgs): Promise<RunClinicalAgentResult>
}
