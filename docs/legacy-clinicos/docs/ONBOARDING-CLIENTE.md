# Onboarding de cliente nuevo (machote)

Receta repetible para montar ClinicOS para una clínica nueva, de cero a WhatsApp
funcionando. Camino real usado en producción: **Dokploy** sobre un VPS por
cliente. (El camino alterno con Caddy está en [DEPLOY-VPS.md](DEPLOY-VPS.md).)

> Regla de oro: **un VPS por cliente**, datos soberanos en su propio Postgres,
> deploy desde GitHub (nunca copiando el repo a mano), credenciales por
> variables de entorno / UI (nunca hardcodeadas).

---

## 0. Lo que necesitas antes de empezar

- [ ] VPS del cliente con **Dokploy** instalado (Swarm + Traefik dueño de 80/443).
- [ ] **Dominio** para el cliente (ej. `clinica.businessmanager.tech`) y acceso al DNS.
- [ ] **Número de WhatsApp** del cliente dado de alta en la Cloud API (tienes el
      `phone_number_id`, el WABA id y un **access token** con permiso sobre él).
- [ ] Llave de IA (Anthropic u OpenRouter) si vas a encender agentes.

---

## 1. DNS

Registro **A**: `clinica.<dominio>` → IP del VPS. Verifica con `dig +short clinica.<dominio>`.

## 2. Base de datos (Postgres aparte)

En Dokploy → **Create → Database → PostgreSQL**. Anota el connection string
**interno** (host del servicio en `dokploy-network`). Esa será tu `DATABASE_URL`.
Va separada de la base de Dokploy para tener backups y panel propios.

## 3. App Compose en Dokploy

Dokploy → **Create → Compose**. Fuente **GitHub**: repo `edusolorzano-ai/clinic-os`,
rama `main`, **Compose Path** `./deploy/dokploy-compose.yml`. Conecta la GitHub App
para **auto-deploy en cada push**. La red `dokploy-network` debe existir (externa).

## 4. Variables de entorno

En la app Compose → **Environment**, pega las variables de
[`deploy/.env.example`](../deploy/.env.example) con los valores reales del cliente.
Las mínimas para arrancar limpio:

```
DATABASE_URL=postgres://...            # del paso 2
NEXT_PUBLIC_ENGINE_URL=/engine
CLINIC_NAME=Clínica del Cliente
CLINIC_VERTICAL=dental                 # o estetica
CLINIC_ADMIN_NOMBRE=Dr. Fulano
SEED_ADMIN_EMAIL=correo@clinica.com
SEED_ADMIN_PASSWORD=<contraseña que define el dueño>
# IA opcional:
OPENROUTER_API_KEY=...   (o ANTHROPIC_API_KEY)
AGENT_MODEL=...
# WhatsApp:
WHATSAPP_VERIFY_TOKEN=<lo inventas>
WHATSAPP_TOKEN=<access token del número>
```

> ⚠️ **NO pongas `SEED_DEMO=true` en un cliente real** — eso siembra pacientes/leads
> de muestra. En base vacía, el motor crea la clínica real desde `CLINIC_*`.

**Decisión por clínica al onboardear — `FEATURE_MEDIA_UNDERSTANDING=true`
(recomendado):** con el flag, el agente ENTIENDE las imágenes/videos/documentos
que manda el paciente (los transcribe UNA vez con el modelo de visión y reutiliza
el texto; cuesta centavos por media). Sin el flag (default), las imágenes llegan
como aviso y el agente pide al paciente que describa en texto — la voz se
transcribe siempre, con o sin flag. Acuérdalo con el dueño según su volumen de
imágenes; nunca lo enciendas global sin esa conversación.

## 5. Dominio en Dokploy

En la app → **Domains**, dos entradas, ambas al dominio del cliente, certResolver
Let's Encrypt:

| Servicio | Host | Path | Notas |
|---|---|---|---|
| `web` | clinica.<dominio> | `/` | — |
| `engine` | clinica.<dominio> | `/engine` | **Strip Path = ON** |

## 6. Deploy y verificación

Dispara **Deploy** (o `git push` si el auto-deploy está activo). Cuando termine:

```bash
curl -s https://clinica.<dominio>/engine/health     # {"ok":true,...,"storage":"postgres"}
```

Entra a `https://clinica.<dominio>`, login con `SEED_ADMIN_EMAIL` + la contraseña.
Debe verse la clínica real **vacía** (0 contactos), no datos demo.

---

## 7. Conectar WhatsApp ⭐ (la parte que cuesta)

### 7.1 Guardar credenciales en ClinicOS
En la web → **Configuración → WhatsApp**: pega `phoneNumberId`, WABA, **access
token**, **verify token** (el mismo de `WHATSAPP_VERIFY_TOKEN`) y `graphVersion`.

### 7.2 Apuntar el webhook al motor
El webhook del cliente es: **`https://clinica.<dominio>/engine/webhook`**

El handshake del motor es **permisivo** (devuelve siempre el `hub.challenge`), así
que la verificación de Meta pasa aunque el verify token no calce al milímetro.

### 7.3 ⚠️ Coexistencia / número ya enrutado a otra app (n8n, ManyChat…)
**Este es el gotcha que cuesta horas.** Si el número ya manda sus webhooks a otra
app (el n8n del dev, ManyChat, etc.), configurar el webhook a nivel *aplicación*
NO basta — los eventos siguen yendo a la otra app. La solución es un **override a
nivel número** vía Graph API, que **tiene prioridad** y **no rompe** la otra app:

```bash
# Ver a dónde apunta HOY el número:
curl "https://graph.facebook.com/v21.0/<PHONE_NUMBER_ID>?fields=webhook_configuration" \
  -H "Authorization: Bearer <ACCESS_TOKEN>"

# Redirigirlo a ClinicOS (override por número):
curl -X POST "https://graph.facebook.com/v21.0/<PHONE_NUMBER_ID>" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  --data-urlencode 'webhook_configuration={"override_callback_uri":"https://clinica.<dominio>/engine/webhook","verify_token":"<VERIFY_TOKEN>"}'
```

### 7.4 Suscribir los campos del webhook (lo hace quien tiene el secreto de la app)
En el App Dashboard de Meta → Webhooks → WABA, suscribir:
- `messages` (entrantes y estados: enviado/entregado/leído)
- `smb_message_echoes` (coexistencia: lo que el doctor escribe desde la app de
  WhatsApp Business aparece en ClinicOS)
- `smb_app_state_sync` (coexistencia: sincroniza contactos)

> Esto requiere el **app secret**, que normalmente solo tiene el developer. El
> access token de usuario NO puede togglear estos campos.

### 7.5 Verificar que entran eventos
En **Configuración → WhatsApp** hay una **bitácora** (webhookLogs). Manda un "hola"
al número y debe aparecer un evento `message`. También se ve por API:

```bash
# (login API → conversations.list / webhookLogs.list), o logs crudos del motor:
docker service logs <engine_service> 2>&1 | grep -i "whatsapp inbound"
```

---

## 8. Conectar Google Calendar (agenda, dos vías)

> La app OAuth de Google se crea **UNA sola vez** para toda la agencia (no por
> cliente). Spec: `docs/superpowers/specs/2026-06-13-google-calendar-sync-design.md`.

**Una sola vez (toda la agencia):** crea la app OAuth en Google Cloud Console
(habilita "Google Calendar API"; pantalla de consentimiento *External* con el
scope `.../auth/calendar`; **publica la app "En producción"** para que el token
no caduque a los 7 días). Copia `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`.

**Por cada cliente que despliegas:**
1. En la app OAuth (consola de Google) → *Authorized redirect URIs* → agrega:
   `https://<dominio-cliente>/engine/oauth/google/callback`
2. Variables de entorno del cliente (mismas llaves de la agencia + propias):
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (compartidas)
   - `GCAL_ENC_KEY` (propia por cliente: `openssl rand -hex 32`) — cifra el token en reposo
   - `PUBLIC_BASE_URL=https://<dominio-cliente>` (para renovar los canales push)
3. El doctor entra a **Configuración → Integraciones → "Conectar Google Calendar"**,
   inicia sesión con su Gmail y acepta (verá una vez "app no verificada → Continuar").

Listo: las citas de ClinicOS se escriben en su Google y los cambios del doctor en
Google se reflejan en ClinicOS (push + sondeo de respaldo). El chequeo free/busy
en vivo al agendar evita dobles agendas. El refresh token nunca sale del VPS del cliente.

---

## 9. Checklist de aceptación (todo el flujo "nivel ManyChat")

Pruébalo con el teléfono del cliente como contraparte:

- [ ] **Recibir** del cliente: texto, foto, **nota de voz**, video, PDF, sticker → todos en la bandeja.
- [ ] **Echo**: el doctor escribe desde WhatsApp Business → aparece como saliente en vivo.
- [ ] **Enviar desde ClinicOS** (clip 📎): foto y PDF → **le llegan al cliente** (tope 40 MB).
- [ ] **Palomitas**: enviado → entregado → **leído (azul)**.
- [ ] **Al cliente**: ve el **visto azul** y el **"escribiendo…"** cuando ClinicOS recibe.
- [ ] El agente IA responde si la conversación está en `ia_activa` (requiere llave de IA).
- [ ] **Google Calendar**: al conectar, crear una cita en ClinicOS la crea en Google; mover una en Google se refleja en ClinicOS; el agente no agenda en horarios ocupados.

---

## 10. Operación

- **Actualizar versión:** `git push` a `main` (auto-deploy), o **Redeploy** en Dokploy.
- **Backups:** `deploy/backup.sh` por cron nocturno (ver [DEPLOY-VPS.md](DEPLOY-VPS.md)).
- **Cambiar contraseña del admin:** desde la UI (o re-bootstrap por env).

## 11. Limitaciones conocidas (a la fecha)

- **Transcripción de notas de voz**: no incluida (requiere un servicio de
  voz-a-texto). Las notas se reproducen y se etiquetan, pero sin texto automático.
- **Historial de 6 meses (coexistencia)**: Meta lo sincroniza aparte; no se importa solo.
- **Tamaño de archivos salientes**: 40 MB (límite del RPC en base64).
- **Seguridad**: rota el access token de WhatsApp si se compartió en chats/tickets.
- **Google Calendar**: v1 = 1 cuenta por clínica (calendario `primary`); eventos
  creados directamente en Google sin cita local no se importan como pacientes (sí
  cuentan para free/busy). La verificación formal de la app de Google se tramita
  aparte para quitar el aviso "app no verificada".
