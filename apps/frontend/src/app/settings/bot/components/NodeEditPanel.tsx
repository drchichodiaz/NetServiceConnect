'use client';
import { useEffect, useState } from 'react';
import { Trash2, Loader2, Plus, X } from 'lucide-react';
import { MenuNode, MenuNodeType } from '@/lib/sortable-tree';
import { TYPE_LABEL } from './MenuNodeRow';

const ADDABLE_TYPES: { type: MenuNodeType; label: string }[] = [
  { type: 'TEXT', label: 'Texto' },
  { type: 'MENU', label: 'Submenú' },
  { type: 'ORDER_LOOKUP', label: 'Consultar pedido' },
  { type: 'AGENT', label: 'Hablar con un agente' },
];

interface FormState {
  title: string;
  subtitle: string;
  bodyText: string;
  promptText: string;
  active: boolean;
}

interface Props {
  node: MenuNode;
  descendantCount: number;
  saving: boolean;
  onSave: (patch: Partial<FormState>) => void;
  onDelete: () => void;
  onAddChild: (type: MenuNodeType) => void;
  onClose: () => void;
}

function toForm(node: MenuNode): FormState {
  return {
    title: node.title,
    subtitle: node.subtitle ?? '',
    bodyText: node.bodyText ?? '',
    promptText: node.promptText ?? '',
    active: node.active,
  };
}

export default function NodeEditPanel({ node, descendantCount, saving, onSave, onDelete, onAddChild, onClose }: Props) {
  const [form, setForm] = useState<FormState>(toForm(node));
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);

  useEffect(() => {
    setForm(toForm(node));
    setConfirmingDelete(false);
    setShowAddMenu(false);
  }, [node.id]);

  function saveField<K extends keyof FormState>(key: K, value: FormState[K]) {
    const next = { ...form, [key]: value };
    setForm(next);
    onSave({ [key]: value } as Partial<FormState>);
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">{TYPE_LABEL[node.type]}</p>
        <div className="flex items-center gap-2">
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin text-ink-subtle" />}
          <button onClick={onClose} className="btn-ghost w-7 h-7 p-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-ink">Título (lo que ve el cliente)</label>
        <input
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          onBlur={(e) => saveField('title', e.target.value)}
          className="input w-full text-sm"
          placeholder="Ej: Horarios"
        />
      </div>

      {(node.type === 'TEXT' || node.type === 'MENU') && (
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-ink flex items-center justify-between">
            <span>Descripción corta</span>
            <span className="text-[10px] font-normal text-ink-subtle">Opcional — se ve en la lista</span>
          </label>
          <input
            value={form.subtitle}
            onChange={(e) => setForm((f) => ({ ...f, subtitle: e.target.value }))}
            onBlur={(e) => saveField('subtitle', e.target.value)}
            className="input w-full text-sm"
            placeholder="Ej: Av. Siempre Viva 742"
          />
        </div>
      )}

      {node.type === 'TEXT' && (
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-ink">Respuesta del bot</label>
          <textarea
            value={form.bodyText}
            onChange={(e) => setForm((f) => ({ ...f, bodyText: e.target.value }))}
            onBlur={(e) => saveField('bodyText', e.target.value)}
            rows={5}
            className="input w-full text-sm"
            placeholder="Lo que responde el bot cuando el cliente elige esta opción"
          />
        </div>
      )}

      {node.type === 'MENU' && (
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-ink flex items-center justify-between">
            <span>Texto del prompt</span>
            <span className="text-[10px] font-normal text-ink-subtle">Opcional</span>
          </label>
          <textarea
            value={form.promptText}
            onChange={(e) => setForm((f) => ({ ...f, promptText: e.target.value }))}
            onBlur={(e) => saveField('promptText', e.target.value)}
            rows={2}
            className="input w-full text-sm"
            placeholder='Ej: "¿Cuál es tu sucursal más cercana?"'
          />
        </div>
      )}

      <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid var(--border)' }}>
        <span className="text-xs font-semibold text-ink">Activa</span>
        <button type="button" onClick={() => saveField('active', !form.active)}>
          <span
            className="w-9 h-5 rounded-full flex items-center px-0.5 transition-colors"
            style={{ background: form.active ? 'var(--green-dark)' : 'var(--border)' }}
          >
            <span
              className="w-4 h-4 rounded-full bg-white transition-transform"
              style={{ transform: form.active ? 'translateX(16px)' : 'translateX(0)' }}
            />
          </span>
        </button>
      </div>

      {node.type === 'MENU' && (
        <div className="pt-3" style={{ borderTop: '1px solid var(--border)' }}>
          {showAddMenu ? (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-ink">Elegí el tipo de opción</p>
              <div className="grid grid-cols-2 gap-2">
                {ADDABLE_TYPES.map((t) => (
                  <button
                    key={t.type}
                    onClick={() => { onAddChild(t.type); setShowAddMenu(false); }}
                    className="btn-secondary text-xs justify-start"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <button onClick={() => setShowAddMenu(false)} className="btn-ghost text-xs w-full">Cancelar</button>
            </div>
          ) : (
            <button onClick={() => setShowAddMenu(true)} className="btn-primary w-full text-sm">
              <Plus className="w-4 h-4" />
              Agregar opción adentro
            </button>
          )}
        </div>
      )}

      <div className="pt-3" style={{ borderTop: '1px solid var(--border)' }}>
        {confirmingDelete ? (
          <div className="space-y-2">
            <p className="text-xs text-ink-muted">
              {descendantCount > 0 && `Esto también elimina ${descendantCount} opción${descendantCount === 1 ? '' : 'es'} adentro. `}
              ¿Eliminar &quot;{node.title}&quot;?
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmingDelete(false)} className="btn-ghost text-xs flex-1">Cancelar</button>
              <button onClick={onDelete} className="btn-primary text-xs flex-1" style={{ background: '#EF4444' }}>
                Eliminar
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setConfirmingDelete(true)} className="btn-ghost text-xs text-red-500 w-full justify-start">
            <Trash2 className="w-3.5 h-3.5" />
            Eliminar opción
          </button>
        )}
      </div>
    </div>
  );
}
