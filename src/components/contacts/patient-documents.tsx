'use client';

// ============================================================
// PatientDocuments — pestaña "Documentos" de la ficha de paciente.
//
// Sube y lista los archivos del paciente guardados en el Google Drive de
// la clínica (comprobantes, estudios, consentimientos). La subida va a
// /api/integrations/google/drive/upload (multipart); el listado a
// /api/integrations/google/drive/documents. Si la clínica no tiene
// Google conectado, la API responde 409 y lo indicamos.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ExternalLink,
  FileText,
  Loader2,
  Upload,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useCan } from '@/hooks/use-can';

interface PatientDocument {
  id: string;
  file_name: string;
  mime_type: string;
  drive_file_id: string;
  drive_web_link: string | null;
  size_bytes: number | null;
  category: string | null;
  created_at: string;
}

const MAX_DOC_BYTES = 25 * 1024 * 1024;

export function PatientDocuments({ contactId }: { contactId: string }) {
  const canUpload = useCan('send-messages');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [documents, setDocuments] = useState<PatientDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/integrations/google/drive/documents?contact_id=${encodeURIComponent(contactId)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error('list');
      const data = (await res.json()) as { documents: PatientDocument[] };
      setDocuments(data.documents);
    } catch {
      toast.error('No se pudieron cargar los documentos');
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite re-elegir el mismo archivo
    if (!file) return;
    if (file.size > MAX_DOC_BYTES) {
      toast.error('El archivo supera el máximo de 25 MB');
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('contact_id', contactId);
      const res = await fetch('/api/integrations/google/drive/upload', {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(
          res.status === 409
            ? 'La clínica no tiene Google conectado (Ajustes → Integraciones).'
            : payload.error || 'No se pudo subir el documento',
        );
      }
      const data = (await res.json()) as { document: PatientDocument };
      setDocuments((prev) => [data.document, ...prev]);
      toast.success('Documento subido a Drive');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo subir');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Documentos del paciente en Google Drive.
        </p>
        {canUpload && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={onPickFile}
            />
            <Button
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              Subir
            </Button>
          </>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Cargando…
        </div>
      ) : documents.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Sin documentos todavía.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 px-3 py-2.5">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {doc.file_name}
                </p>
                <p className="nums text-xs text-muted-foreground">
                  {formatSize(doc.size_bytes)} · {formatDate(doc.created_at)}
                </p>
              </div>
              {doc.drive_web_link && (
                <a
                  href={doc.drive_web_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  Abrir
                  <ExternalLink className="size-3" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatSize(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
