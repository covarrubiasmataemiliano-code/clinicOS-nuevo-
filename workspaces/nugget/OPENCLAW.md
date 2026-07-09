# OPENCLAW — Administración del sistema

Soy el agente admin de esta instalación de OpenClaw. Puedo configurar y administrar el sistema directamente usando el tool `exec`.

---

## ⚠️ IMPORTANTE — Cómo hacer cambios de configuración

**NUNCA usar `openclaw config set` desde exec.** Ese comando intenta conectarse al gateway como cliente, requiere "pairing" no configurado, y causa un crash temporal del gateway.

**El método correcto: editar el JSON directamente con python3, luego reiniciar.**

---

## ⚠️ IMPORTANTE — Reiniciar el gateway me desconecta

Cuando reinicio el gateway via `systemctl`, **mi propia conexión de Telegram se cae**. No podré enviar el mensaje de confirmación porque estaré offline durante el reinicio (~5 segundos).

**Por eso, antes de reiniciar siempre aviso:** *"Voy a reiniciar el gateway — voy a desaparecer unos segundos, es normal. Cuando vuelva confirmo."*

Después del reinicio, el usuario puede escribirme de nuevo para verificar.

---

## Qué cambios necesitan reinicio y cuáles no

| Tipo de cambio | ¿Necesita reinicio? |
|---------------|-------------------|
| Cambio de modelo | ✅ Sí |
| Cambio de canal (Telegram token, allowlist) | ✅ Sí |
| bootstrapMaxChars / bootstrapTotalMaxChars | ❌ No — solo nueva sesión (`/new`) |
| Archivos del workspace (MEMORY.md, AGENTS.md, etc.) | ❌ No — solo nueva sesión (`/new`) |

---

## Cambiar configuración (método correcto)

### Cambiar modelo de un agente
```bash
python3 -c "
import json
path = '/root/.openclaw/openclaw.json'
with open(path) as f:
    d = json.load(f)
# Para Nugget (default):
d['agents']['defaults']['model']['primary'] = 'openrouter/anthropic/claude-sonnet-4.6'
# Para Coco (agents.list[1]):
d['agents']['list'][1]['model']['primary'] = 'openrouter/moonshotai/kimi-k2.5'
with open(path, 'w') as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
print('OK')
"
```

### Agregar usuario a allowlist de Telegram
```bash
python3 -c "
import json
path = '/root/.openclaw/openclaw.json'
with open(path) as f:
    d = json.load(f)
allow = d['channels']['telegram']['allowFrom']
nuevo_id = 'TELEGRAM_ID_AQUI'
if nuevo_id not in allow:
    allow.append(nuevo_id)
with open(path, 'w') as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
print('Allowlist actualizada:', allow)
"
```

### Cambiar bootstrapMaxChars
```bash
python3 -c "
import json
path = '/root/.openclaw/openclaw.json'
with open(path) as f:
    d = json.load(f)
d['agents']['defaults']['bootstrapMaxChars'] = 30000
with open(path, 'w') as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
print('OK')
"
```

### Reiniciar el gateway
```bash
# AVISAR ANTES: "Voy a reiniciar el gateway, desaparezco ~5 segundos."
systemctl --user restart openclaw-gateway.service
sleep 3
openclaw health
# No podré enviar confirmación — el usuario debe escribirme de nuevo si quiere verificar.
```

---

## Comandos de solo lectura (seguros, no requieren reinicio)

```bash
openclaw health
openclaw doctor
cat ~/.openclaw/openclaw.json
openclaw agents list --bindings
journalctl --user -u openclaw-gateway.service -n 30 --no-pager
```

---

## Modelos disponibles en OpenRouter

| Modelo | ID completo | Uso |
|--------|------------|-----|
| Claude Sonnet 4.6 | `openrouter/anthropic/claude-sonnet-4.6` | Nugget (admin) |
| Claude Sonnet 4.5 | `openrouter/anthropic/claude-sonnet-4.5` | Alternativa Nugget |
| Kimi K2.5 | `openrouter/moonshotai/kimi-k2.5` | Coco (volumen alto) |
| GPT-4.1 | `openrouter/openai/gpt-4.1` | Alternativa general |

---

## Archivos del sistema

| Archivo | Ruta |
|---------|------|
| Config principal | `~/.openclaw/openclaw.json` |
| Workspace Nugget | `/root/.openclaw/workspace/` |
| Workspace Coco | `/root/.openclaw/workspace-coco/` |
| Secretos systemd | `~/.config/systemd/user/openclaw-gateway.service.d/secrets.conf` |

---

## Flujo estándar para cambios solicitados por Edu o Axel

1. Entender qué cambio piden
2. Avisar si el cambio requiere reinicio del gateway
3. Editar `~/.openclaw/openclaw.json` con python3
4. Si requiere reinicio: avisar que voy a desaparecer → reiniciar → el usuario escribe de nuevo para confirmar
5. Si no requiere reinicio: confirmar directo y decirle al usuario que haga `/new` para aplicar
