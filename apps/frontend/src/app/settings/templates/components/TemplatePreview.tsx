'use client';
import { Image as ImageIcon, ExternalLink, Phone, CornerUpLeft } from 'lucide-react';
import type { TemplateButton } from '@/lib/api';

interface Props {
  headerFormat?: 'TEXT' | 'IMAGE' | null;
  headerText?: string | null;
  /** URL de la imagen ya subida, o un objectURL mientras se elige el archivo. */
  headerImageUrl?: string | null;
  bodyText: string;
  footerText?: string | null;
  buttons?: TemplateButton[] | null;
  /** Valores de ejemplo, para mostrar la plantilla llena en vez de con {{1}}. */
  exampleValues?: string[];
  headerExampleValues?: string[];
}

/**
 * La plantilla como la va a ver el cliente en WhatsApp.
 *
 * Existe porque el formulario son cuatro bloques sueltos y nadie puede anticipar
 * como quedan juntos — sobre todo el orden encabezado/cuerpo/pie y cuanto ocupan
 * los botones. Es aproximada a proposito: no intenta imitar WhatsApp pixel a pixel,
 * solo dejar clara la estructura antes de mandar la plantilla a aprobar.
 */
export function TemplatePreview({
  headerFormat,
  headerText,
  headerImageUrl,
  bodyText,
  footerText,
  buttons,
  exampleValues = [],
  headerExampleValues = [],
}: Props) {
  // Con valores de ejemplo cargados se muestran en lugar de {{n}}; sin ellos queda
  // el marcador, que es mas util que un hueco vacio.
  function fill(text: string, values: string[]) {
    return text.replace(/\{\{(\d+)\}\}/g, (match, idx) => {
      const value = values[Number(idx) - 1];
      return value?.trim() ? value : match;
    });
  }

  const hasButtons = (buttons?.length ?? 0) > 0;

  return (
    <div
      className="rounded-xl p-4"
      style={{
        // El fondo de chat de WhatsApp, apenas insinuado para que la burbuja se lea.
        background: 'var(--surface-muted)',
        border: '1px solid var(--border)',
      }}
    >
      <p className="text-[11px] text-ink-subtle mb-2.5">Así lo va a ver el cliente</p>

      <div
        className="rounded-lg overflow-hidden shadow-sm"
        style={{ background: 'var(--bubble-out, #DCF8C6)', maxWidth: 320 }}
      >
        {headerFormat === 'IMAGE' && (
          <div
            className="w-full flex items-center justify-center"
            style={{ aspectRatio: '1.91 / 1', background: 'rgba(0,0,0,0.06)' }}
          >
            {headerImageUrl ? (
              // Imagen local o servida por la API: <img> normal, no next/image.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={headerImageUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="flex flex-col items-center gap-1 text-ink-subtle">
                <ImageIcon className="w-5 h-5" />
                <span className="text-[11px]">Sin imagen todavía</span>
              </div>
            )}
          </div>
        )}

        <div className="px-3 py-2.5">
          {headerFormat === 'TEXT' && headerText?.trim() && (
            <p className="text-[13px] font-bold text-black/85 mb-1 break-words">
              {fill(headerText, headerExampleValues)}
            </p>
          )}

          <p className="text-[13px] text-black/85 whitespace-pre-wrap break-words">
            {bodyText.trim() ? fill(bodyText, exampleValues) : 'El cuerpo del mensaje va acá.'}
          </p>

          {footerText?.trim() && (
            <p className="text-[11px] text-black/45 mt-1.5 break-words">{footerText}</p>
          )}
        </div>

        {hasButtons && (
          <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)' }}>
            {buttons!.map((button, i) => (
              <div
                key={i}
                className="flex items-center justify-center gap-1.5 py-2 text-[13px] font-medium"
                style={{
                  color: '#00A5F4',
                  borderTop: i > 0 ? '1px solid rgba(0,0,0,0.08)' : undefined,
                }}
              >
                {button.type === 'URL' && <ExternalLink className="w-3.5 h-3.5" />}
                {button.type === 'PHONE_NUMBER' && <Phone className="w-3.5 h-3.5" />}
                {button.type === 'QUICK_REPLY' && <CornerUpLeft className="w-3.5 h-3.5" />}
                <span className="truncate">{button.text?.trim() || 'Botón sin texto'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
