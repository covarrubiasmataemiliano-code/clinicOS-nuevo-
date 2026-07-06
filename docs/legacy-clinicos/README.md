# Material rescatado de ClinicOS 2.0 (repo legacy)

Archivos copiados verbatim de `DevAI-MX/ClinicOS-c-digo-limpio-2.0` (julio 2026).
**Son REFERENCIA, no código activo** — la carpeta está excluida del typecheck
(`tsconfig.json → exclude`). Al portar algo, se adapta y se reescribe dentro de `src/`.

## Contenido

| Carpeta | Qué hay | Por qué se rescató |
|---|---|---|
| `seeds/` | Los 4 seeds de clínicas: **devia** (dental, Método DEVIA de venta consultiva), **moreno** (estética, Coach de Ventas + 6 agentes), **andrei** (rinoplastia, cliente real Becerril con horarios reales), **oranza** (dental/ATM) | La fuente completa del contexto de negocio: catálogos con precios, `notasVenta` (directrices de venta por procedimiento), manejo de objeciones, políticas de anticipos, horarios, prompts modulares por clínica (secciones SOUL/AGENTS/CLINIC/SCHEDULE_POLICY/NOTIFICATIONS/SECURITY/TOOLS) |
| `agentes/` | Runtime de agentes del engine: recepcionista, pacientes, concierge (+ sus tools), router determinista, `funnel.ts` (embudo en código), guards de honestidad (mutation/payment/capability), anti prompt-injection, fallback de modelos | Los prompts de comportamiento ("Reglas de ejecución innegociables", "regla de oro del anticipo", matriz de escalación) y los patrones de arquitectura que SÍ funcionaron |
| `contratos/` | Schemas zod clave: `config.ts` (AgentConfig/PromptSection), `agenda.ts` (citas/anticipos/disponibilidad), `inbox.ts`, `crm.ts`, `data-provider.ts` | Modelo de dominio clínico ya pensado: tipos de cita, `depositStatus`, `DoctorSchedule`, clasificación de leads — guía para las tablas nuevas en Supabase |
| `ui/` | `globals.css` (tema porcelana/grafito + azul petróleo, OKLCH, sombras soft/lifted/floating), `status-maps.ts`, `status-badge.tsx`, `segment.ts`, `rbac.ts`, `app-shell.tsx` | El sistema de diseño a replicar sobre esta base |
| `docs/` | CAMBIOS-SAAS.md (diagnóstico de los problemas conversacionales), HANDOFF.md, MOTOR-APRENDIZAJE.md, AGENTIC-ERP.md, ONBOARDING-CLIENTE.md, spec del recepcionista IA | La memoria institucional: qué falló, por qué, y qué decisiones de producto ya están tomadas |
| `screenshots/` | 10 capturas del panel legacy (login, inbox, kanban, agenda, finanzas, copiloto, auditor, configuración, notificaciones, expediente) | Referencia visual para el port de UI |

## Lo que NO se rescató (a propósito)

- El loop conversacional del engine (buffer de ráfagas con `sleep`+`Set`s, ventana de 20
  mensajes, estado KV-blob): es donde vivían los problemas — se rediseña, no se porta.
- El resto del monorepo (apps/web completa, mocks, deploy): el repo original sigue en
  GitHub si algo más hace falta.
