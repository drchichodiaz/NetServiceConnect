'use client';
import { useState, useRef, useEffect } from 'react';
import { Conversation } from '@/types';
import { X, Ticket, CheckSquare, UserPlus, Loader2, CheckCircle, ChevronRight } from 'lucide-react';
import clsx from 'clsx';

// ─── NetService logo SVG ──────────────────────────────────────────────────────

function NetServiceLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Loop left */}
      <path d="M18 24c0-4.4-3.6-8-8-8s-8 3.6-8 8 3.6 8 8 8c2.8 0 5.3-1.5 6.8-3.7"
        stroke="#1B4BA8" strokeWidth="4.5" strokeLinecap="round" fill="none"/>
      {/* Loop right */}
      <path d="M30 24c0 4.4 3.6 8 8 8s8-3.6 8-8-3.6-8-8-8c-2.8 0-5.3 1.5-6.8 3.7"
        stroke="#1B4BA8" strokeWidth="4.5" strokeLinecap="round" fill="none"/>
      {/* Center cross */}
      <path d="M18 24c1.5-2.2 3.7-3.7 6-3.7s4.5 1.5 6 3.7-3.7 3.7-6 3.7-4.5-1.5-6-3.7z"
        fill="#1B4BA8"/>
      {/* Dots top right */}
      <rect x="36" y="6"  width="3" height="3" rx="0.5" fill="#1B4BA8" opacity="0.4"/>
      <rect x="41" y="6"  width="3" height="3" rx="0.5" fill="#1B4BA8" opacity="0.7"/>
      <rect x="36" y="11" width="3" height="3" rx="0.5" fill="#1B4BA8" opacity="0.7"/>
      <rect x="41" y="11" width="3" height="3" rx="0.5" fill="#1B4BA8"/>
      {/* Dots bottom left */}
      <rect x="4"  y="34" width="3" height="3" rx="0.5" fill="#7BA3D8" opacity="0.7"/>
      <rect x="9"  y="34" width="3" height="3" rx="0.5" fill="#7BA3D8" opacity="0.4"/>
      <rect x="4"  y="39" width="3" height="3" rx="0.5" fill="#7BA3D8"/>
      <rect x="9"  y="39" width="3" height="3" rx="0.5" fill="#7BA3D8" opacity="0.7"/>
    </svg>
  );
}

// ─── Actions config ───────────────────────────────────────────────────────────

const ACTIONS = [
  {
    id: 'ticket',
    label: 'Crear ticket',
    desc: 'Registrar incidencia en NetService',
    icon: Ticket,
    color: '#EF4444',
    bg: '#FEF2F2',
    prefix: 'TK',
    fields: [
      { key: 'title',    label: 'Título',    type: 'text',   fromConv: 'lastMessage' },
      { key: 'priority', label: 'Prioridad', type: 'select', options: ['Alta', 'Media', 'Baja'] },
      { key: 'area',     label: 'Área',      type: 'select', options: ['Soporte', 'Ventas', 'Técnico', 'Facturación'] },
    ],
  },
  {
    id: 'task',
    label: 'Crear tarea',
    desc: 'Asignar tarea de seguimiento',
    icon: CheckSquare,
    color: '#3B82F6',
    bg: '#EFF6FF',
    prefix: 'TA',
    fields: [
      { key: 'title',   label: 'Título',      type: 'text',   fromConv: 'lastMessage' },
      { key: 'due',     label: 'Vencimiento', type: 'date' },
      { key: 'notes',   label: 'Notas',       type: 'textarea' },
    ],
  },
  {
    id: 'client',
    label: 'Crear cliente',
    desc: 'Registrar contacto como cliente',
    icon: UserPlus,
    color: '#25D366',
    bg: '#E8FBF0',
    prefix: 'CL',
    fields: [
      { key: 'name',    label: 'Nombre',    type: 'text',  fromConv: 'contactName' },
      { key: 'phone',   label: 'Teléfono',  type: 'text',  fromConv: 'contactPhone' },
      { key: 'email',   label: 'Email',     type: 'email' },
      { key: 'company', label: 'Empresa',   type: 'text' },
    ],
  },
];

// ─── Modal ────────────────────────────────────────────────────────────────────

function ActionModal({
  action, conversation, onClose,
}: {
  action: typeof ACTIONS[0];
  conversation: Conversation;
  onClose: () => void;
}) {
  const Icon = action.icon;
  const [form,    setForm]    = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    action.fields.forEach((f) => {
      if (f.fromConv === 'lastMessage')   init[f.key] = conversation.lastMessageText || '';
      if (f.fromConv === 'contactName')   init[f.key] = conversation.contact.name || '';
      if (f.fromConv === 'contactPhone')  init[f.key] = conversation.contact.phone || '';
      if (f.type === 'select')            init[f.key] = f.options?.[0] || '';
      if (!(f.key in init))               init[f.key] = '';
    });
    return init;
  });
  const [loading,  setLoading]  = useState(false);
  const [done,     setDone]     = useState(false);
  const [ref,      setRef]      = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    // Simular llamada a NetService API
    await new Promise((r) => setTimeout(r, 1200));
    const id = `${action.prefix}-${Math.floor(Math.random() * 9000) + 1000}`;
    setRef(id);
    setLoading(false);
    setDone(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-white rounded-2xl shadow-float w-full max-w-md animate-pop"
        style={{ border: '1px solid var(--border)' }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: action.bg }}>
            <Icon className="w-4 h-4" style={{ color: action.color }} />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-ink text-sm">{action.label}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <NetServiceLogo className="w-3.5 h-3.5" />
              <span className="text-[11px] text-ink-muted">NetService</span>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost w-7 h-7 p-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {done ? (
          /* Success state */
          <div className="px-5 py-8 flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
              style={{ background: action.bg }}>
              <CheckCircle className="w-7 h-7" style={{ color: action.color }} />
            </div>
            <p className="font-semibold text-ink mb-1">{action.label.replace('Crear', '')} creado</p>
            <p className="text-xs text-ink-muted mb-3">Registrado en NetService correctamente</p>
            <span className="font-mono text-sm font-bold px-3 py-1.5 rounded-lg"
              style={{ background: action.bg, color: action.color }}>
              #{ref}
            </span>
            <button onClick={onClose} className="mt-5 btn-ghost text-sm">Cerrar</button>
          </div>
        ) : (
          /* Form */
          <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
            {action.fields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <label className="text-xs font-semibold text-ink">{field.label}</label>
                {field.type === 'select' ? (
                  <select
                    value={form[field.key]}
                    onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
                    className="input w-full text-sm"
                  >
                    {field.options?.map((o) => <option key={o}>{o}</option>)}
                  </select>
                ) : field.type === 'textarea' ? (
                  <textarea
                    value={form[field.key]}
                    onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
                    rows={3}
                    className="input w-full text-sm resize-none"
                  />
                ) : (
                  <input
                    type={field.type}
                    value={form[field.key]}
                    onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
                    className="input w-full text-sm"
                  />
                )}
              </div>
            ))}

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
                style={{ background: action.color }}
              >
                {loading
                  ? <><Loader2 className="w-4 h-4 animate-spin" />Enviando a NetService...</>
                  : <><Icon className="w-4 h-4" />{action.label}</>}
              </button>
              <button type="button" onClick={onClose} className="btn-ghost px-4 text-sm">
                Cancelar
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Main panel button ────────────────────────────────────────────────────────

interface Props {
  conversation: Conversation;
}

export default function NetServicePanel({ conversation }: Props) {
  const [open,   setOpen]   = useState(false);
  const [active, setActive] = useState<typeof ACTIONS[0] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <>
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className={clsx(
            'btn-ghost w-8 h-8 p-0 flex items-center justify-center',
            open && 'bg-blue-50',
          )}
          title="Acciones NetService"
        >
          <NetServiceLogo className="w-5 h-5" />
        </button>

        {open && (
          <div
            className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-float z-30 overflow-hidden animate-pop"
            style={{ border: '1px solid var(--border)', width: '240px' }}
          >
            {/* Panel header */}
            <div className="px-4 py-3 flex items-center gap-2.5" style={{ borderBottom: '1px solid var(--border)', background: '#F8FAFF' }}>
              <NetServiceLogo className="w-5 h-5" />
              <div>
                <p className="text-xs font-bold text-ink">NetService</p>
                <p className="text-[10px] text-ink-muted">Acciones rápidas</p>
              </div>
            </div>

            {/* Actions list */}
            {ACTIONS.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.id}
                  onClick={() => { setActive(action); setOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-surface-muted transition-colors text-left"
                >
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: action.bg }}>
                    <Icon className="w-3.5 h-3.5" style={{ color: action.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-ink">{action.label}</p>
                    <p className="text-[10px] text-ink-muted truncate">{action.desc}</p>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                </button>
              );
            })}

            <div className="px-4 py-2.5" style={{ borderTop: '1px solid var(--border)', background: '#F8FAFF' }}>
              <p className="text-[10px] text-ink-subtle text-center">
                Integrado con NetService Core
              </p>
            </div>
          </div>
        )}
      </div>

      {active && (
        <ActionModal
          action={active}
          conversation={conversation}
          onClose={() => setActive(null)}
        />
      )}
    </>
  );
}
