'use client';

// ============================================================
// GoogleIntegration — Settings → Integraciones
//
// Conecta el Google de la clínica (una conexión por cuenta): calendario
// "Clínica" para reflejar las citas del panel, y Drive para documentos
// de pacientes y respaldos. El botón manda al flujo OAuth server-side
// (/api/integrations/google/connect); al volver, la URL trae
// ?google=ok|error&code=... y mostramos el resultado.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  CalendarDays,
  CheckCircle2,
  FolderOpen,
  Loader2,
  Link2,
  Unplug,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useCan } from '@/hooks/use-can';
import { SettingsPanelHead } from './settings-panel-head';

interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  calendar_id: string | null;
  drive_ready: boolean;
}

/** Mensajes legibles para los códigos que devuelve el callback. */
const RESULT_MESSAGES: Record<string, string> = {
  connected: 'Google conectado. Las citas del panel se reflejarán en el calendario de la clínica.',
  consent_denied: 'Cancelaste el permiso de Google.',
  bad_state: 'La sesión de conexión expiró. Intenta de nuevo.',
  missing_params: 'Faltaron datos en la respuesta de Google.',
  provisioning: 'No se pudo preparar el calendario o Drive. Intenta de nuevo.',
  no_refresh_token:
    'Google no entregó permiso permanente. Quita el acceso de la app en tu cuenta de Google y reconecta.',
  store_failed: 'No se pudo guardar la conexión.',
  google_not_configured: 'La integración de Google no está configurada en el servidor.',
  forbidden: 'Necesitas rol admin para conectar Google.',
};

export function GoogleIntegration() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const canEdit = useCan('edit-settings');

  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/google/status', {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('status');
      setStatus((await res.json()) as GoogleStatus);
    } catch {
      toast.error('No se pudo leer el estado de Google');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // Resultado del flujo OAuth (?google=ok|error&code=...). Lo mostramos
  // y limpiamos los params para que un refresh no repita el toast.
  useEffect(() => {
    const kind = searchParams.get('google');
    const code = searchParams.get('code');
    if (!kind) return;
    const message = (code && RESULT_MESSAGES[code]) || 'Operación completada.';
    if (kind === 'ok') toast.success(message);
    else toast.error(message);

    const params = new URLSearchParams(searchParams.toString());
    params.delete('google');
    params.delete('code');
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch('/api/integrations/google/disconnect', {
        method: 'POST',
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || 'No se pudo desconectar');
      }
      toast.success('Google desconectado');
      await loadStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo desconectar');
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <section className="max-w-2xl animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead
        title="Integraciones"
        description="Conecta servicios externos. Google enlaza el calendario de la clínica y Google Drive para documentos de pacientes."
      />

      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CalendarDays className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                Google Calendar + Drive
              </p>
              <p className="text-xs text-muted-foreground">
                Una conexión por clínica. Las citas del panel aparecen en el
                calendario de Google; los documentos de pacientes se guardan en
                Drive.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Cargando estado…
            </div>
          ) : !status?.configured ? (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              La integración no está configurada en el servidor (faltan las
              credenciales de Google OAuth). Contacta a tu administrador.
            </p>
          ) : status.connected ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="inline-flex items-center gap-1.5 text-foreground">
                  <CheckCircle2 className="size-4 text-success" />
                  Conectado
                  {status.email ? (
                    <span className="text-muted-foreground">· {status.email}</span>
                  ) : null}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="size-3.5" />
                  Calendario listo
                </span>
                {status.drive_ready && (
                  <span className="inline-flex items-center gap-1.5">
                    <FolderOpen className="size-3.5" />
                    Drive listo
                  </span>
                )}
              </div>
              {canEdit && (
                <Button
                  variant="outline"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="border-red-500/40 bg-red-500/10 text-red-300 hover:border-red-500/60 hover:bg-red-500/20 hover:text-red-200"
                >
                  {disconnecting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Unplug className="size-4" />
                  )}
                  Desconectar
                </Button>
              )}
            </div>
          ) : canEdit ? (
            // Enlace directo al flujo server-side (redirección OAuth).
            <Button
              render={
                <a href="/api/integrations/google/connect">
                  <Link2 className="size-4" />
                  Conectar con Google
                </a>
              }
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              Aún no está conectado. Pide a un administrador que conecte Google.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
