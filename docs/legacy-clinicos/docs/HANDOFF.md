# ClinicOS — Documento de Entrega (HANDOFF)

> Versión de fase: **Frontend completo (Fase 1)**
> Fecha: junio 2026
> Autor del entregable: Eduardo Solórzano / Agencia de IA

---

## Tabla de contenidos

1. [¿Qué es ClinicOS?](#1-qué-es-clinicos)
2. [Estado actual — qué está hecho](#2-estado-actual--qué-está-hecho)
3. [Stack tecnológico](#3-stack-tecnológico)
4. [Estructura del monorepo](#4-estructura-del-monorepo)
5. [Cómo correr el proyecto](#5-cómo-correr-el-proyecto)
6. [Patrón DataProvider — cómo conectar el backend](#6-patrón-dataprovider--cómo-conectar-el-backend)
7. [Variable de entorno `NEXT_PUBLIC_DATA_PROVIDER`](#7-variable-de-entorno-next_public_data_provider)
8. [Caché de la demo y `SEED_VERSION`](#8-caché-de-la-demo-y-seed_version)
9. [Usuarios y clínicas demo](#9-usuarios-y-clínicas-demo)
10. [Modelo de permisos (RBAC)](#10-modelo-de-permisos-rbac)
11. [Los 8 módulos](#11-los-8-módulos)
12. [Guion de demo — 12 pasos](#12-guion-de-demo--12-pasos)
13. [Fuera de alcance en esta fase](#13-fuera-de-alcance-en-esta-fase)
14. [Roadmap del backend](#14-roadmap-del-backend)
15. [Deploy](#15-deploy)
16. [PWA — cómo instalar](#16-pwa--cómo-instalar)

---

## 1. ¿Qué es ClinicOS?

ClinicOS es una plataforma SaaS tipo ManyChat/GoHighLevel diseñada específicamente para clínicas médicas. Eduardo, como tech provider aprobado de Meta con acceso a la WhatsApp Cloud API, implementa agentes de IA que atienden el WhatsApp de los doctores: califican leads, agendan citas en Google Calendar, cobran anticipos y escalan conversaciones a humanos cuando es necesario.

ClinicOS reemplaza el stack operativo actual (ManyChat + n8n + OpenClaw). Se despliega por cliente en un VPS (Hostinger) y está proyectado para convertirse en un SaaS multi-cliente. Esta **Fase 1** entrega el frontend completo de los 8 módulos, 100 % funcional contra datos simulados, más los contratos de API tipados que el backend deberá implementar sin tocar la UI.

---

## 2. Estado actual — qué está hecho

| Componente | Estado | Notas |
|---|---|---|
| `apps/web` — Next.js frontend | **Completo** | 8 módulos, rutas, guards, RBAC |
| `packages/contracts` — Interfaz DataProvider | **Completo** | ~2 550 líneas, 9 dominios, ~70 métodos |
| `packages/mocks` — MockProvider + seeds | **Completo** | Estado en memoria + localStorage, 35/35 tests pasando |
| `apps/engine` — Backend Fastify | **Stub (solo README)** | No implementado; arquitectura definida |
| OAuth real Google/Meta | Pendiente | Fase F1/F2 del roadmap |
| Webhooks WhatsApp Cloud API | Pendiente | Fase F1 del roadmap |

El frontend jamás toca los mocks directamente. Toda la capa de datos está abstraída detrás de la interfaz `DataProvider`. Cambiar de mocks a backend real es cuestión de implementar esa misma interfaz y ajustar la variable de entorno.

---

## 3. Stack tecnológico

| Capa | Tecnología | Versión |
|---|---|---|
| Framework | Next.js (App Router) | 16.2.7 |
| Lenguaje | TypeScript (strict) | ^5 |
| Estilos | Tailwind CSS v4 | ^4 |
| Componentes UI | shadcn/ui + radix-ui | — |
| Estado servidor | TanStack Query | ^5.101 |
| Tablas | TanStack Table | ^8.21 |
| Kanban | dnd-kit | ^6.3 / ^10.0 |
| Gráficas | Recharts | 3.8.0 |
| Fechas | date-fns (locale `es`) | ^4.4 |
| Iconos | lucide-react | ^1.17 |
| Animaciones | motion (framer-motion) | ^12.40 |
| Toasts | sonner | ^2.0.7 |
| Validación / contratos | zod | ^4.4.3 |
| Gestor de paquetes | pnpm workspaces | 11.5.2 |
| Runtime | Node.js | 20+ |

---

## 4. Estructura del monorepo

```
clinic-os/
├── apps/
│   ├── web/                        # App Next.js (la interfaz principal)
│   │   └── src/
│   │       ├── app/
│   │       │   ├── (app)/          # Rutas autenticadas: /inbox, /crm, /agenda, etc.
│   │       │   └── (auth)/login    # Pantalla de login con selector de clínica/usuario
│   │       ├── components/         # Componentes React reutilizables
│   │       └── lib/
│   │           ├── data/           # Hooks de datos por dominio + provider-factory.tsx
│   │           ├── rbac.ts         # Cálculo de permisos efectivos
│   │           ├── format.ts       # Utilidades de formato
│   │           └── status-maps.ts  # Mapeos de estado a etiqueta/color
│   │
│   └── engine/                     # Stub del backend futuro (solo README.md)
│                                   # Stack planeado: Fastify + BullMQ + Postgres/pgvector
│                                   #               + Redis + Vercel AI SDK
│
├── packages/
│   ├── contracts/                  # FUENTE DE VERDAD DE LA API
│   │                               # Esquemas zod + interfaz DataProvider
│   │                               # ~2 550 líneas, 9 dominios, ~70 métodos
│   │
│   └── mocks/                      # Implementación de DataProvider para desarrollo
│                                   # Estado mutable en memoria + persistencia localStorage
│                                   # Latencia simulada 150-400 ms
│                                   # Seeds: 2 clínicas demo
│                                   # Tests vitest: 35/35 pasando
│
└── docs/
    ├── HANDOFF.md                  # Este archivo
    ├── CONVENTIONS.md
    └── screenshots/
```

---

## 5. Cómo correr el proyecto

### Requisitos

- **Node.js 20+**
- **pnpm 11.5.2** (`npm install -g pnpm@11.5.2`)

### Instalación y arranque

```bash
# Clonar el repositorio
git clone <repo-url>
cd clinic-os

# Instalar todas las dependencias del monorepo
pnpm install

# Levantar el servidor de desarrollo (http://localhost:3000)
pnpm dev
```

### Scripts disponibles (desde la raíz)

| Comando | Descripción |
|---|---|
| `pnpm dev` | Levanta `apps/web` en modo desarrollo en `http://localhost:3000` |
| `pnpm build` | Build de producción de todos los paquetes (`pnpm -r build`) |
| `pnpm typecheck` | Type-check de todos los paquetes (`pnpm -r typecheck`) |
| `pnpm lint` | Linting de todos los paquetes (`pnpm -r lint`) |
| `pnpm test` | Ejecuta los tests en todos los paquetes (`pnpm -r test`) — actualmente 35/35 en `packages/mocks` con vitest |
| `pnpm verify` | **Verificación completa**: `typecheck && lint && test && build` |

> **Recomendación antes de hacer merge:** ejecutar `pnpm verify` para confirmar que el proyecto pasa typecheck, linting, tests y build de producción en un solo comando.

### Primer inicio de sesión

Al abrir `http://localhost:3000`, el middleware redirige a `/login`. Selecciona una clínica y un usuario (ver sección 9). La ruta por defecto tras el login es `/inbox`.

---

## 6. Patrón DataProvider — cómo conectar el backend

Este es el concepto más importante de la arquitectura. **El frontend nunca importa los mocks directamente.**

### La interfaz

```
packages/contracts/src/provider.ts
```

Define la interfaz `DataProvider` con ~70 métodos organizados en 9 dominios (conversaciones, pacientes, citas, pagos, configuración, etc.). Esta interfaz es la fuente de verdad de la API: lo que el frontend necesita del backend está completamente especificado aquí.

### Las implementaciones

| Implementación | Paquete | Cuándo se usa |
|---|---|---|
| `MockProvider` | `packages/mocks` | Hoy — desarrollo y demos |
| `ApiProvider` | `apps/web/src/lib/data/` (a crear) | Cuando el backend esté listo |

### El factory

```
apps/web/src/lib/data/provider-factory.tsx
```

Lee la variable de entorno `NEXT_PUBLIC_DATA_PROVIDER` y devuelve la implementación correspondiente. El resto de la app no sabe ni le importa cuál está activa.

### Los hooks de datos

```
apps/web/src/lib/data/       # Un hook por dominio
@/lib/data                   # Barrel de re-exportación
```

Cada hook usa TanStack Query internamente y llama al DataProvider. **Para conectar el backend, la estrategia es:**

1. Implementar los métodos de `DataProvider` en `ApiProvider` dominio por dominio (no hace falta hacerlo todo de golpe).
2. Cambiar `NEXT_PUBLIC_DATA_PROVIDER=api` en el entorno de staging.
3. Los módulos cuyo dominio ya esté implementado en el backend empezarán a funcionar con datos reales automáticamente; los demás siguen usando el mock mientras tanto (se puede hacer un factory híbrido por dominio si se prefiere un rollout gradual).
4. No hay que tocar ningún componente de la UI.

---

## 7. Variable de entorno `NEXT_PUBLIC_DATA_PROVIDER`

```bash
# Archivo .env.local en apps/web/
NEXT_PUBLIC_DATA_PROVIDER=mock   # valor por defecto — usa MockProvider
NEXT_PUBLIC_DATA_PROVIDER=api    # usará ApiProvider (a implementar)
```

Si la variable no está definida, el factory cae en `mock` por defecto. Esta es la única variable de entorno necesaria para correr la fase frontend.

---

## 8. Caché de la demo y `SEED_VERSION`

El estado de la demo se persiste en `localStorage` bajo la clave:

```
clinicos-demo-state-v{SEED_VERSION}
```

- **TTL:** 24 horas. Pasado ese tiempo, el estado se reinicia automáticamente con los datos seed.
- **`SEED_VERSION`** es una constante definida en `packages/mocks/src/db.ts`. Su valor actual es `3`.

### Regla importante al modificar los datos seed

Si se modifican los datos en `packages/mocks/src/db.ts` (agregar pacientes, cambiar conversaciones, etc.), **se debe incrementar `SEED_VERSION`** para invalidar la caché del navegador. Si no se incrementa, los usuarios con la demo abierta seguirán viendo los datos anteriores aunque el código haya cambiado.

### Reinicio manual

Hay un botón **"Reiniciar demo"** en el menú del avatar (arriba a la derecha, dentro de la app) que restablece el estado de localStorage inmediatamente sin esperar el TTL.

---

## 9. Usuarios y clínicas demo

En `/login` se puede elegir entre dos clínicas precargadas en los seeds.

### Clínica: Dr. Esteban Moreno (estética — datos más ricos)

| Usuario | Rol | Módulos accesibles | Notas |
|---|---|---|---|
| Eduardo Solórzano | `superadmin` | Los 8 módulos, incluido Auditor | Cuenta de la agencia |
| Dr. Esteban Moreno | `administrador` | Todos menos Auditor | Dueño de la clínica |
| Dra. Sofía Hernández | `doctor` | Sin Finanzas por defecto | Útil para demostrar permisos granulares |
| Mariana López | `auxiliar` | Bandeja, CRM, Agenda, Notificaciones | — |
| Axel Ramírez | `auxiliar` | Bandeja, CRM, Agenda, Notificaciones | — |

### Clínica: Dental Oranza (dental)

| Usuario | Rol | Módulos accesibles |
|---|---|---|
| Dr. Ángel Zavala | `administrador` | Todos menos Auditor |
| Karen Jiménez | `auxiliar` | Bandeja, CRM, Agenda, Notificaciones |

---

## 10. Modelo de permisos (RBAC)

Cada usuario tiene dos capas de configuración de acceso:

1. **`role`** — plantilla de permisos por defecto (`superadmin` / `administrador` / `doctor` / `auxiliar`).
2. **`modulePermissions`** — overrides por módulo que el administrador puede editar en **Configuración > Usuarios** mediante switches individuales.

`lib/rbac.ts` combina ambas capas y calcula los permisos efectivos. Este resultado alimenta:

- **Sidebar / bottom-tabs (móvil):** solo se muestran los módulos con acceso.
- **Guards de URL:** si un usuario accede directamente a una ruta sin permiso, es redirigido con un toast de error.

### Módulo exclusivo

El módulo **Auditor** solo es accesible para usuarios con rol `superadmin`. No puede ser activado via override para otros roles.

---

## 11. Los 8 módulos

### 1. Bandeja (`/inbox`)

Interfaz de conversaciones estilo WhatsApp con tres columnas: lista de conversaciones, chat y panel de sugerencias IA. Tabs Leads / Pacientes / Otros con búsqueda y filtros por clasificación de lead (preguntón / interesado / seguimiento). Toggle de control de IA en tres estados: IA activa (verde pulsante), Humano (azul) y Pausada (ámbar), con etiqueta "Cambiado por X hace Y". Soporte multimedia completo: notas de voz con player y transcript, imágenes y archivos adjuntos. Panel derecho con 3 borradores de sugerencia (Enviar / Editar / Regenerar) y switch "Consultor de ventas" que ajusta el tono a cierre de ventas. Editar un borrador registra `SuggestionFeedback` para aprendizaje futuro. Incluye banner de escalación a humano, dictado por voz (Web Speech API, locale `es-MX`) y acción "Mover a blacklist".

### 2. CRM (`/crm`, `/crm/pacientes/[id]`)

Es el expediente clínico digital y la fuente de verdad del paciente. Vista kanban con drag-and-drop (dnd-kit) en 8 etapas configurables, más vista tabla. El expediente 360° del paciente incluye los tabs: Resumen, Datos y antecedentes, Conversaciones (historial completo), Citas, Pagos, Notas clínicas y Archivos. El nombre y el número de WhatsApp del paciente tienen un candado de identidad que previene ediciones accidentales.

### 3. Agenda (`/agenda`)

Calendario con vistas mes / semana / día e indicador de sincronización con Google Calendar. Implementa la **regla de oro del anticipo**: una cita con `depositStatus="pendiente"` no puede confirmarse hasta registrar el pago. Los montos de anticipo vienen de `DepositSettings` (configurable por clínica y por doctor, sin valores hardcodeados). El CTA "Registrar pago" confirma la cita al completar el anticipo.

### 4. Copiloto (`/copiloto`)

Diseñado mobile-first para usarse durante la consulta. Flujo completo: agenda del día → iniciar consulta con grabación + timer + transcript por chunks (simulado) → generar documentos clínicos (Nota clínica, Receta, Cotización) editables → aprobar (genera PDF mock archivado al expediente y a Drive) → "Enviar por WhatsApp" (crea el mensaje real en el chat del paciente en la Bandeja).

### 5. Finanzas (`/finanzas`)

Módulo de administración con KPIs y gráficas (Recharts) del negocio. Tabla de movimientos con dos fuentes: pagos registrados automáticamente desde el CRM y gastos manuales. Flujo de captura de gastos: subir foto de ticket → OCR simulado → registrar gasto estructurado. Reportes P&L mensuales descargables. Chat integrado con consultor financiero IA. Visible solo para usuarios con permiso (administrador por defecto; configurable).

### 6. Auditor (`/auditor`)

Exclusivo del rol `superadmin` (la agencia). Muestra el `healthScore` de la instalación, lista de verificaciones con deep-links a la entidad afectada, fallos por agente IA, métricas de latencia (p50/p95) e histórico de reportes de auditoría.

### 7. Configuración (`/configuracion`)

Panel de administración con múltiples secciones: editor del prompt maestro (secciones en accordion con badge "Editable por la clínica" vs candado "Gestionada por la agencia", con versionado de cambios); Asistente de catálogo IA (el doctor dicta sus procedimientos y rangos de precio y aparecen borradores estructurados); configuración de pagos y anticipos con cuentas bancarias; gestión de usuarios con switches de permisos por módulo; horarios por sede; WhatsApp multi-número; blacklist; integraciones; y configuración de white-label (logo + color primario con preview en vivo).

### 8. Notificaciones (`/notificaciones`)

Centro de notificaciones agrupadas por día. Soporta 8 tipos de notificación validados contra el schema de contracts. Cada notificación incluye un deep-link a la entidad relacionada (conversación, cita, expediente de paciente).

---

## 12. Guion de demo — 12 pasos

Este guion muestra el valor completo de la plataforma en una sesión de demostración de 20-30 minutos.

**1. Login con superadmin**
Abrir `/login`, seleccionar la clínica "Dr. Esteban Moreno" e iniciar sesión como **Eduardo Solórzano** (superadmin). Verificar que el menú lateral muestra los 8 módulos, incluido Auditor, que solo aparece para el rol `superadmin`.

**2. Bandeja — conversación de un lead**
Ir a `/inbox` y abrir la conversación de **Carlos Medina** (clasificado como lead "preguntón"). Mostrar las burbujas de chat estilo WhatsApp, los mensajes multimedia y el toggle de IA en verde pulsante (IA activa).

**3. Bandeja — control del toggle de IA**
Cambiar el toggle de "IA activa" a "Humano" y luego a "Pausada". Señalar la etiqueta que aparece debajo del toggle: "Cambiado por Eduardo hace X minutos", demostrando trazabilidad de quién tomó el control.

**4. Bandeja — sugerencias IA y feedback**
En el panel derecho, editar el texto de uno de los 3 borradores de respuesta sugeridos y enviarlo (esto registra un `SuggestionFeedback` que el backend futuro usará para mejorar el modelo). Luego activar el switch **"Consultor de ventas"** y observar cómo los 3 borradores cambian a un tono orientado al cierre de objeciones.

**5. CRM — kanban con drag-and-drop**
Ir a `/crm` y mostrar el tablero kanban con las 8 etapas del funnel. Arrastrar una tarjeta de paciente de una columna a la siguiente; el estado se actualiza en tiempo real en el MockProvider.

**6. CRM — expediente 360°**
Abrir el expediente de la paciente **Laura Gutiérrez** y recorrer todos los tabs: Resumen, Datos y antecedentes, Conversaciones (historial completo de WhatsApp), Citas (con su estado de anticipo), Pagos, Notas clínicas y Archivos. Este es el repositorio central de información del paciente.

**7. Agenda — regla del anticipo**
Ir a `/agenda` y abrir una cita que tenga anticipo pendiente (`depositStatus="pendiente"`). Mostrar el Alert con el monto requerido y el botón **"Registrar pago"**: intentar confirmar la cita sin pagar primero (bloqueado) y luego completar el flujo de pago para confirmarla. Esta regla de negocio es configurable por clínica y doctor desde Configuración.

**8. Copiloto — flujo completo de consulta (vista móvil)**
Cambiar el navegador a viewport móvil e ir a `/copiloto`. Seleccionar la consulta de hoy, iniciar la grabación (timer + transcript por chunks aparecen en pantalla), detener la grabación y generar los tres documentos: Nota clínica, Receta y Cotización. Aprobar la cotización (se archiva como PDF mock en el expediente). Pulsar **"Enviar por WhatsApp"** y verificar que el mensaje aparece en la Bandeja del paciente.

**9. Finanzas — KPIs, gastos y consultor IA**
Ir a `/finanzas`. Mostrar los KPIs del mes y las gráficas de ingresos. Subir una foto de ticket de gasto → el OCR simulado extrae los datos y presenta un borrador → registrar el gasto. Abrir el chat del consultor financiero IA y hacer una pregunta sobre el margen del mes.

**10. Configuración — permisos granulares en vivo**
Ir a `/configuracion`. Explorar el editor del prompt maestro (señalar la diferencia visual entre secciones con candado de agencia y secciones editables por la clínica). Abrir el Asistente de catálogo IA. Luego ir a **Usuarios** → buscar a la **Dra. Sofía Hernández** → activar el switch del módulo **Finanzas**. Cerrar sesión, iniciar sesión como Sofía y verificar que ahora aparece el módulo Finanzas en su menú. Esto demuestra el modelo de permisos granular en tiempo real.

**11. Auditor — visión de la agencia**
Volver a iniciar sesión como **Eduardo Solórzano**. Ir a `/auditor` y mostrar el `healthScore` de la instalación, la lista de verificaciones (con links directos a la entidad con problema), los fallos por agente IA y las métricas de latencia p50/p95. Este módulo es invisible para los demás roles.

**12. Notificaciones y reinicio de demo**
Ir a `/notificaciones` y mostrar las notificaciones agrupadas por día con los deep-links a cada entidad. Para cerrar, mostrar el botón **"Reiniciar demo"** en el menú desplegable del avatar (arriba a la derecha), que restablece el estado completo de la demo a los datos seed originales.

---

## 13. Fuera de alcance en esta fase

Los siguientes componentes están definidos en los contratos y contemplados en el roadmap, pero **no están implementados en esta fase**:

| Funcionalidad | Motivo / Fase |
|---|---|
| Backend real (`apps/engine`) | Solo README — Fase F1 |
| OAuth real Google Calendar | Fase F1 |
| Webhooks reales WhatsApp Cloud API | Fase F1 |
| Transcripción de audio real (Whisper STT) | Fase F4. El dictado en Bandeja usa Web Speech API (soporte parcial en Safari/iOS) |
| Generación de PDF real | Fase F4 |
| OCR real de tickets | Fase F5 |
| Push notifications y modo offline de la PWA | La PWA es instalable pero no tiene service worker de offline en esta fase |
| Aprendizaje real de la IA | Solo se captura `SuggestionFeedback` con contador — Fase F3 |
| Sincronización multiusuario en tiempo real (SSE/WebSocket) | Fase F1 |

---

## 14. Roadmap del backend

El backend se construirá en `apps/engine` implementando la misma interfaz `DataProvider` de `packages/contracts`. El reemplazo del `MockProvider` por el `ApiProvider` puede hacerse dominio por dominio sin modificar la UI.

| Fase | Contenido |
|---|---|
| **F1 — Núcleo** | `apps/engine` operativo. Webhooks WhatsApp Cloud API. Bandeja en tiempo real (SSE). Pipeline multimedia. Máquina de estados IA/Humano/Pausada. `ApiProvider` reemplaza a `MockProvider` módulo por módulo. |
| **F2 — Agente recepcionista** | Clasificación de leads (Claude Haiku). Conversación con pacientes (Claude Sonnet + prompt caching). Agenda en Google Calendar. Cobro de anticipos. Escalación a humano. Gestión de blacklist. |
| **F3 — Agente de pacientes y aprendizaje** | Historial clínico en retrieval (pgvector). Aprendizaje real desde `SuggestionFeedback`. |
| **F4 — Copiloto real** | Whisper STT para transcripción. Generación de PDFs y archivado en Google Drive. |
| **F5 — Consultores IA** | Consultor de ventas. Consultor financiero con OCR real de tickets. Auditor diario automatizado. |
| **F6 — SaaS y migración** | Migración de datos reales de clientes actuales. Embedded Signup de Meta. Arquitectura multi-tenant. |

### Estrategia de costos de IA

- Modelo ligero (Claude Haiku) para tareas mecánicas de clasificación.
- Prompt caching (~90 % de descuento en tokens repetidos del prompt maestro).
- Batch API (−50 %) para procesamiento nocturno.
- Capa de proveedor agnóstica via Vercel AI SDK, configurable por agente.
- Estimado: ~15–40 USD/mes de API por clínica (base: ~1 500 mensajes/mes). A validar con datos reales en F1.

---

## 15. Deploy

### Objetivo (producción por cliente)

Un VPS **Hostinger KVM2** por cliente, con Docker Compose:

```
caddy          → proxy inverso + HTTPS automático
web            → app Next.js (apps/web)
engine         → backend Fastify (apps/engine, Fase F1+)
postgres       → PostgreSQL con extensión pgvector
redis          → colas BullMQ + caché
```

Imágenes publicadas en GHCR. Backup nocturno a Google Drive.

### Ahora (Fase 1 — solo frontend)

Para demos y desarrollo basta con correr en local con `pnpm dev`. Para desplegar a un entorno compartido, `apps/web` puede desplegarse como sitio Next.js estándar (Vercel, cualquier hosting con soporte Node.js, o exportación estática).

```bash
# Build de producción
pnpm build

# Servir en producción (desde apps/web)
pnpm --filter @clinicos/web start
```

---

## 16. PWA — cómo instalar

ClinicOS es una Progressive Web App instalable. Funciona en el navegador y puede agregarse a la pantalla de inicio del dispositivo sin pasar por la App Store ni Google Play.

### iPhone (Safari requerido)

1. Abrir la URL en **Safari** (no funciona en Chrome iOS para instalación).
2. Pulsar el botón **Compartir** (icono de cuadrado con flecha hacia arriba).
3. Desplazarse en el menú y seleccionar **"Agregar a inicio"**.
4. Confirmar el nombre y pulsar **"Agregar"**.

### Android (Chrome recomendado)

1. Abrir la URL en **Chrome**.
2. Pulsar el menú de tres puntos (arriba a la derecha).
3. Seleccionar **"Instalar app"** o **"Agregar a pantalla de inicio"**.
4. Confirmar.

Una vez instalada, la app abre en pantalla completa sin barra del navegador, con el ícono en la pantalla de inicio. En esta fase la PWA es instalable pero **no tiene service worker de offline** (requiere conexión a internet para funcionar).

## 17. Backend real (apps/engine) — actualización

Lo que era un stub ya es un servicio funcional. `apps/engine` expone el
DataProvider completo sobre HTTP reusando la lógica de `@clinicos/mocks`
(estado en memoria por sesión; Postgres llega en F1.5 sin cambiar el contrato):

- `POST /rpc` `{domain, method, args}` → cualquiera de los 133 métodos.
- `GET /events` → SSE (`message` / `notification` / `transcript`).
- `GET|POST /webhook` → WhatsApp Cloud API (verificación + entrantes; keyed por `phone_number_id`).
- `POST /agent/reply` → corre el agente recepcionista bajo demanda.
- `GET /health`.

El frontend cambia de fuente con dos variables (cero cambios de pantallas):
`NEXT_PUBLIC_DATA_PROVIDER=api` + `NEXT_PUBLIC_ENGINE_URL` (p.ej. `/engine`).
Implementación: `apps/web/src/lib/data/api-provider.ts` (Proxy + EventSource).

Agentes IA (`apps/engine/src/agents/`): prompt maestro armado desde las
PromptSections del `AgentConfig` (editables en Configuración → Agentes) +
tools TypeScript (catálogo, anticipos, disponibilidad, crear cita, clasificar,
escalar a humano) vía Vercel AI SDK. Gated por `ANTHROPIC_API_KEY`; el envío
real por Graph API gated por `WHATSAPP_TOKEN` (sin token = dry-run).

Deploy por cliente en VPS: ver **docs/DEPLOY-VPS.md** (Docker Compose + Caddy).

Correr en local: `pnpm --filter @clinicos/engine dev` (puerto 3001) y la web
con `NEXT_PUBLIC_DATA_PROVIDER=api NEXT_PUBLIC_ENGINE_URL=http://localhost:3001 pnpm dev`.

## 18. Login real y arranque de clínica (producción)

En producción (`DATABASE_URL` presente) el login demo queda **deshabilitado**
(403) y la web muestra formulario de **correo + contraseña**:

- Contrato: `auth.login(email, password)` y `auth.changePassword(actual, nueva)`
  (opcionales — el mock de la demo no los implementa).
- Hash scrypt (`node:crypto`, formato `scrypt$salt$hash`) en la colección
  `credentials` del estado; jamás viaja al cliente.
- `ALLOW_DEMO_LOGIN=true` reactiva el selector demo (pruebas locales).

CLI de arranque (corre en el VPS, requiere `DATABASE_URL`):

```bash
# Clínica nueva REAL (vacía, sin datos demo) + admin con contraseña:
pnpm --filter @clinicos/engine bootstrap create-clinic -- \
  --nombre "Clínica X" --vertical estetica \
  --admin-email doctor@clinica.mx --admin-password 'Secreta123' \
  --admin-nombre "Dr. X"

# Asignar/restablecer contraseña a un usuario existente:
pnpm --filter @clinicos/engine bootstrap set-password -- \
  --email doctor@clinica.mx --password 'Nueva456'
```

> ⚠️ **Regla operativa:** corre los comandos de `bootstrap` con el engine
> DETENIDO (`docker compose stop engine` → bootstrap → `start engine`).
> El engine escribe su estado completo al apagarse; si corre a la vez que el
> bootstrap, puede pisar lo que el script acaba de guardar.
