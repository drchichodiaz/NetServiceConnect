'use client';
import { Plus, Trash2, ExternalLink, Phone, CornerUpLeft, ArrowUp, ArrowDown } from 'lucide-react';
import type { TemplateButton, TemplateButtonType } from '@/lib/api';

interface Props {
  buttons: TemplateButton[];
  onChange: (buttons: TemplateButton[]) => void;
}

const MAX_BUTTONS = 10;
const MAX_URL = 2;
const MAX_PHONE = 1;
const MAX_TEXT = 25;

const TYPE_META: Record<TemplateButtonType, { label: string; hint: string; icon: typeof Plus }> = {
  QUICK_REPLY: {
    label: 'Respuesta rápida',
    hint: 'El cliente la toca y su texto vuelve como un mensaje suyo.',
    icon: CornerUpLeft,
  },
  URL: { label: 'Enlace', hint: 'Abre una página web.', icon: ExternalLink },
  PHONE_NUMBER: { label: 'Llamar', hint: 'Marca un número de teléfono.', icon: Phone },
};

/**
 * Los limites que aplica esta pantalla son los de Meta, no invenciones nuestras:
 * hasta 10 botones, 2 de enlace y 1 de telefono. Se desactivan los botones de
 * "agregar" en vez de dejar sumar y que Meta rechace la plantilla despues.
 */
export function ButtonsEditor({ buttons, onChange }: Props) {
  const urlCount = buttons.filter((b) => b.type === 'URL').length;
  const phoneCount = buttons.filter((b) => b.type === 'PHONE_NUMBER').length;
  const full = buttons.length >= MAX_BUTTONS;

  function add(type: TemplateButtonType) {
    onChange([...buttons, { type, text: '' }]);
  }

  function update(index: number, patch: Partial<TemplateButton>) {
    onChange(buttons.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  }

  function remove(index: number) {
    onChange(buttons.filter((_, i) => i !== index));
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= buttons.length) return;
    const next = [...buttons];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function canAdd(type: TemplateButtonType) {
    if (full) return false;
    if (type === 'URL') return urlCount < MAX_URL;
    if (type === 'PHONE_NUMBER') return phoneCount < MAX_PHONE;
    return true;
  }

  return (
    <div>
      <label className="text-xs font-semibold text-ink block mb-1.5">Botones (opcional)</label>

      {buttons.length > 0 && (
        <div className="space-y-2 mb-2">
          {buttons.map((button, i) => {
            const meta = TYPE_META[button.type];
            const Icon = meta.icon;
            const isDynamicUrl = button.type === 'URL' && (button.url ?? '').includes('{{1}}');

            return (
              <div
                key={i}
                className="rounded-lg p-2.5"
                style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                  <span className="text-[11px] font-semibold text-ink-muted flex-1">{meta.label}</span>
                  <button
                    type="button" onClick={() => move(i, -1)} disabled={i === 0}
                    title="Subir"
                    className="w-6 h-6 rounded flex items-center justify-center text-ink-subtle hover:text-ink hover:bg-black/5 disabled:opacity-30"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button" onClick={() => move(i, 1)} disabled={i === buttons.length - 1}
                    title="Bajar"
                    className="w-6 h-6 rounded flex items-center justify-center text-ink-subtle hover:text-ink hover:bg-black/5 disabled:opacity-30"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button" onClick={() => remove(i)}
                    title="Quitar botón"
                    className="w-6 h-6 rounded flex items-center justify-center text-ink-subtle hover:text-red-500 hover:bg-red-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <input
                  required
                  maxLength={MAX_TEXT}
                  placeholder="Texto del botón"
                  value={button.text}
                  onChange={(e) => update(i, { text: e.target.value })}
                  className="input w-full text-sm"
                />
                <p className="text-[10px] text-ink-subtle mt-1 text-right">
                  {button.text.length}/{MAX_TEXT}
                </p>

                {button.type === 'URL' && (
                  <>
                    <input
                      required
                      placeholder="https://tusitio.com/pedido/{{1}}"
                      value={button.url ?? ''}
                      onChange={(e) => update(i, { url: e.target.value })}
                      className="input w-full text-sm font-mono mt-1"
                    />
                    <p className="text-[10px] text-ink-subtle mt-1">
                      Podés terminar la URL en <code>{'{{1}}'}</code> para que cambie en cada envío.
                    </p>
                    {isDynamicUrl && (
                      <input
                        required
                        placeholder="Ejemplo del valor variable (ej: A-1043)"
                        value={button.urlExample ?? ''}
                        onChange={(e) => update(i, { urlExample: e.target.value })}
                        className="input w-full text-sm mt-1.5"
                      />
                    )}
                  </>
                )}

                {button.type === 'PHONE_NUMBER' && (
                  <input
                    required
                    placeholder="+507 6000-0000"
                    value={button.phoneNumber ?? ''}
                    onChange={(e) => update(i, { phoneNumber: e.target.value })}
                    className="input w-full text-sm mt-1"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(TYPE_META) as TemplateButtonType[]).map((type) => {
          const meta = TYPE_META[type];
          const Icon = meta.icon;
          const enabled = canAdd(type);
          return (
            <button
              key={type}
              type="button"
              onClick={() => add(type)}
              disabled={!enabled}
              title={enabled ? meta.hint : 'Llegaste al máximo que permite Meta para este tipo'}
              className="btn-secondary text-xs py-1.5 px-2.5 disabled:opacity-40"
            >
              <Icon className="w-3.5 h-3.5" />
              {meta.label}
            </button>
          );
        })}
      </div>

      <p className="text-[11px] text-ink-subtle mt-1.5">
        Meta permite hasta {MAX_BUTTONS} botones: {MAX_URL} de enlace, {MAX_PHONE} de teléfono y el resto de
        respuesta rápida. Si mezclás, las respuestas rápidas tienen que ir todas juntas.
      </p>
    </div>
  );
}
