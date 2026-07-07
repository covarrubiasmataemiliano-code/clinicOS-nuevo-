// ============================================================
// clinicOS — agente de Atención (tool-calling). Superficie pública.
// ============================================================

export { runClinicalAgent } from './loop'
export type {
  RunClinicalAgentArgs,
  RunClinicalAgentResult,
} from './loop'
export { buildClinicalSystemPrompt } from './prompt'
export type { ClinicalPromptArgs } from './prompt'
export { CLINICAL_TOOLS } from './tools'
export type { AgentToolContext } from './tools'
export { clinicTimezone } from './clinic-time'
