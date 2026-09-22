'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { botsApi, settingsApi, BotSummary } from '@/lib/api';
import {
  Bot, Check, Loader2, LayoutDashboard, ArrowRight, Sparkles, AlertTriangle, Plus, Copy, Star, Trash2, Pencil, X, Phone,
  HelpCircle, ChevronDown,
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import MenuTreeEditor from './components/MenuTreeEditor';

const AI_KNOWLEDGE_MAX_LENGTH = 20000;

export default function BotSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [bots, setBots] = useState<BotSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hasOpenaiKey, setHasOpenaiKey] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  // Arranca siempre plegada: abierta ocupaba la pantalla entera al entrar.
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [list, settings] = await Promise.all([botsApi.list(), settingsApi.get()]);
        setBots(list);
        setSelectedId(list.find((b) => b.isDefault)?.id ?? list[0]?.id ?? null);
        setHasOpenaiKey(!!settings.hasOpenaiKey);
      } catch {
        toast.error('Error al cargar los bots');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const selected = bots.find((b) => b.id === selectedId) ?? null;

  async function reload(selectId?: string) {
    const list = await botsApi.list();
    setBots(list);
    if (selectId) setSelectedId(selectId);
    else if (!list.some((b) => b.id === selectedId)) setSelectedId(list.find((b) => b.isDefault)?.id ?? null);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const created = await botsApi.create(newName.trim());
      await reload(created.id);
      setCreating(false);
      setNewName('');
      toast.success('Bot creado');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo crear el bot');
    } finally {
      setBusy(false);
    }
  }

  async function handleDuplicate(bot: BotSummary) {
    setBusy(true);
    try {
      const copy = await botsApi.duplicate(bot.id);
      await reload(copy.id);
      toast.success(`Se creó "${copy.name}" con todas sus opciones`);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo duplicar el bot');
    } finally {
      setBusy(false);
    }
  }

  async function handleSetDefault(bot: BotSummary) {
    try {
      setBots(await botsApi.setDefault(bot.id));
      toast.success(`"${bot.name}" es ahora el bot predeterminado`);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo cambiar el predeterminado');
    }
  }

  async function handleDelete(bot: BotSummary) {
    const linesNote = bot.lines.length > 0
      ? ` Las ${bot.lines.length} línea(s) que atiende pasan al bot predeterminado.`
      : '';
    if (!confirm(`¿Eliminar "${bot.name}" y todas sus opciones de menú?${linesNote}`)) return;
    try {
      const list = await botsApi.remove(bot.id);
      setBots(list);
      setSelectedId(list.find((b) => b.isDefault)?.id ?? null);
      toast.success('Bot eliminado');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo eliminar el bot');
    }
  }

  function patchSelected(patch: Partial<BotSummary>) {
    setBots((prev) => prev.map((b) => (b.id === selectedId ? { ...b, ...patch } : b)));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-10 px-6 animate-fade-in space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#E8FBF0' }}>
            <Bot className="w-4 h-4" style={{ color: '#128C7E' }} />
          </div>
          <h1 className="text-xl font-bold text-ink" style={{ letterSpacing: '-0.02em' }}>
            Bots de WhatsApp
          </h1>
        </div>
        <p className="text-sm text-ink-muted mt-1">
          Cada bot tiene su propio menú y su propia información para el modo IA. Puedes tener uno de ventas, otro de
          soporte, y elegir cuál atiende cada línea en{' '}
          <Link href="/settings/whatsapp" className="underline font-semibold">Configuración → WhatsApp</Link>.
        </p>
      </div>

      <Link href="/dashboard" className="card p-4 flex items-center gap-3 hover:shadow-card-md transition-shadow group">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: '#E8FBF0' }}>
          <LayoutDashboard className="w-4 h-4" style={{ color: '#128C7E' }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink">Ver métricas de los bots</p>
          <p className="text-xs text-ink-muted">Conversaciones resueltas, derivadas y consultas, por bot o todas juntas — en el Dashboard general</p>
        </div>
        <ArrowRight className="w-4 h-4 text-ink-subtle shrink-0 group-hover:translate-x-0.5 transition-transform" />
      </Link>

      {/* Panel plegable de ayuda — mismo patron que "¿Como funciona una campaña?". */}
      <div className="card overflow-hidden">
        <button
          onClick={() => setShowHelp((v) => !v)}
          className="w-full flex items-center gap-2 px-5 py-3 text-left hover:bg-surface-hover transition-colors"
          aria-expanded={showHelp}
        >
          <HelpCircle className="w-4 h-4 text-ink-muted shrink-0" />
          <span className="text-sm font-medium text-ink flex-1">¿Cómo funcionan los bots?</span>
          <ChevronDown className={`w-4 h-4 text-ink-muted shrink-0 transition-transform ${showHelp ? 'rotate-180' : ''}`} />
        </button>

        {showHelp && (
          <div className="px-5 pb-5 pt-1 space-y-4 animate-fade-in border-t border-line">
            <p className="text-xs text-ink-muted leading-relaxed pt-3">
              Un bot es lo que responde cuando un cliente escribe por primera vez a una línea de WhatsApp, antes de
              que lo atienda una persona. Puedes tener <strong className="text-ink font-medium">varios</strong> — por
              ejemplo uno de ventas y otro de soporte — y cada línea usa el suyo.
            </p>

            <div className="space-y-2.5">
              <Step n="1" title="Cada bot tiene lo suyo">
                Su <strong className="text-ink font-medium">menú de opciones</strong>, su{' '}
                <strong className="text-ink font-medium">información del negocio</strong> para el modo IA y la forma en
                que arranca (con el menú o directo en chat con IA). Cambiar uno no toca a los demás.
              </Step>
              <Step n="2" title="Crea uno nuevo o duplica">
                <strong className="text-ink font-medium">Nuevo bot</strong> lo crea vacío.{' '}
                <strong className="text-ink font-medium">Duplicar</strong> copia otro con todas sus opciones y su
                información de IA — es lo más rápido para armar, por ejemplo, el de soporte a partir del principal.
              </Step>
              <Step n="3" title="Arma el menú tranquilo">
                Selecciona el bot en la lista y edítalo abajo. Un bot que no atiende ninguna línea no lo ve ningún
                cliente, así que puedes prepararlo sin apuro.
              </Step>
              <Step n="4" title="Asígnalo a una línea">
                En <Link href="/settings/whatsapp" className="underline font-medium text-ink">Configuración → WhatsApp</Link>,
                cada línea tiene un selector <strong className="text-ink font-medium">Atiende</strong>: el bot
                predeterminado, un bot en particular o <strong className="text-ink font-medium">Sin bot</strong>.
              </Step>
            </div>

            <div className="rounded-lg px-3 py-2.5 space-y-2" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
              <p className="text-[11px] text-ink-muted leading-relaxed">
                <strong className="text-ink font-medium">El predeterminado</strong> atiende las líneas a las que no les
                elegiste bot, incluidas las que conectes de ahora en adelante. No se puede eliminar: primero marca otro
                como predeterminado.
              </p>
              <p className="text-[11px] text-ink-muted leading-relaxed">
                <strong className="text-ink font-medium">Una línea sin bot</strong> manda las conversaciones directo a
                la bandeja, repartidas entre los agentes que pueden ver esa línea.
              </p>
              <p className="text-[11px] text-ink-muted leading-relaxed">
                <strong className="text-ink font-medium">Los cambios valen para las conversaciones nuevas.</strong> Si
                le cambias el bot a una línea, quien ya estaba usando el menú termina con el bot con el que empezó.
                Si eliminas un bot, sus líneas pasan al predeterminado.
              </p>
              <p className="text-[11px] text-ink-muted leading-relaxed">
                <strong className="text-ink font-medium">La clave de OpenAI es una sola</strong> para todos los bots
                (en Configuración → IA). Lo que cambia de un bot a otro es la información del negocio que usa para responder.
              </p>
              <p className="text-[11px] text-ink-muted leading-relaxed">
                <strong className="text-ink font-medium">Las métricas</strong> del Dashboard se pueden ver por bot o de
                todos juntos.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ─── Lista de bots ─────────────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
          <p className="text-sm font-semibold text-ink">Tus bots</p>
          {!creating && (
            <button onClick={() => setCreating(true)} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Nuevo bot
            </button>
          )}
        </div>

        {creating && (
          <form onSubmit={handleCreate} className="px-5 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setCreating(false); setNewName(''); } }}
              placeholder="Ej: Bot de ventas"
              maxLength={60}
              className="input flex-1 text-sm py-1.5"
            />
            <button type="submit" disabled={busy || !newName.trim()} className="btn-primary text-xs px-3 py-1.5">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Crear vacío'}
            </button>
            <button type="button" onClick={() => { setCreating(false); setNewName(''); }} className="btn-ghost text-xs px-2.5 py-1.5">
              Cancelar
            </button>
          </form>
        )}
        {creating && (
          <p className="px-5 pt-2 pb-3 text-[11px] text-ink-subtle" style={{ borderBottom: '1px solid var(--border)' }}>
            ¿Quieres partir de uno que ya tienes? Usa <strong>Duplicar</strong> en ese bot: copia todas sus opciones y su información de IA.
          </p>
        )}

        <div className="divide-y divide-border">
          {bots.map((bot) => (
            <BotRow
              key={bot.id}
              bot={bot}
              selected={bot.id === selectedId}
              busy={busy}
              onSelect={() => setSelectedId(bot.id)}
              onRenamed={(name) => setBots((prev) => prev.map((b) => (b.id === bot.id ? { ...b, name } : b)))}
              onDuplicate={() => handleDuplicate(bot)}
              onSetDefault={() => handleSetDefault(bot)}
              onDelete={() => handleDelete(bot)}
            />
          ))}
        </div>
      </div>

      {/* ─── Editor del bot seleccionado ───────────────────────────────────── */}
      {selected && (
        <>
          <div className="flex items-center gap-2 pt-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">Editando</p>
            <p className="text-sm font-semibold text-ink">{selected.name}</p>
          </div>

          {selected.lines.length === 0 && (
            <div className="flex items-start gap-2 rounded-xl p-3 text-xs" style={{ background: '#EEF2FF', color: '#3730A3' }}>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                Este bot todavía no atiende ninguna línea. Puedes armarlo tranquilo: nadie lo ve hasta que lo asignes a una
                línea en <Link href="/settings/whatsapp" className="underline font-semibold">Configuración → WhatsApp</Link>.
              </span>
            </div>
          )}

          <MenuTreeEditor
            botId={selected.id}
            onCountChange={(nodeCount) => patchSelected({ nodeCount })}
            aiMissing={[
              ...(!selected.aiKnowledgeBase?.trim() ? ['la información del negocio (más abajo en esta página)'] : []),
              ...(!hasOpenaiKey ? ['la clave de OpenAI (Configuración → IA)'] : []),
            ]}
          />

          <AiCard
            key={selected.id}
            bot={selected}
            hasOpenaiKey={hasOpenaiKey}
            onSaved={patchSelected}
          />
        </>
      )}
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <span className="text-[11px] font-semibold text-ink bg-surface-hover rounded px-1.5 py-0.5 h-fit shrink-0">{n}</span>
      <p className="text-xs text-ink-muted leading-relaxed">
        <strong className="text-ink font-medium">{title}.</strong> {children}
      </p>
    </div>
  );
}

// ─── Fila de un bot ───────────────────────────────────────────────────────────

function BotRow({
  bot, selected, busy, onSelect, onRenamed, onDuplicate, onSetDefault, onDelete,
}: {
  bot: BotSummary;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onRenamed: (name: string) => void;
  onDuplicate: () => void;
  onSetDefault: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(bot.name);
  const [saving, setSaving] = useState(false);

  async function saveName() {
    if (!draft.trim() || draft.trim() === bot.name) { setEditing(false); setDraft(bot.name); return; }
    setSaving(true);
    try {
      const updated = await botsApi.update(bot.id, { name: draft.trim() });
      onRenamed(updated.name);
      setEditing(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo renombrar');
    } finally {
      setSaving(false);
    }
  }

  const lineNames = bot.lines.map((l) => l.label?.trim() || l.phoneNumber || 'Línea sin nombre');

  return (
    <div
      onClick={onSelect}
      className={clsx('px-5 py-3.5 flex items-start gap-3 cursor-pointer transition-colors', selected ? 'bg-green-50/60' : 'hover:bg-gray-50')}
      style={selected ? { boxShadow: 'inset 3px 0 0 #25D366' } : undefined}
    >
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: selected ? '#E8FBF0' : 'var(--surface-muted)' }}>
        {bot.startInAiChat
          ? <Sparkles className="w-4 h-4" style={{ color: '#9333EA' }} />
          : <Bot className="w-4 h-4" style={{ color: selected ? '#128C7E' : undefined }} />}
      </div>

      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveName();
                if (e.key === 'Escape') { setDraft(bot.name); setEditing(false); }
              }}
              maxLength={60}
              className="input flex-1 text-sm py-1"
            />
            <button onClick={saveName} disabled={saving} className="btn-ghost w-7 h-7 p-0">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" style={{ color: '#25D366' }} />}
            </button>
            <button onClick={() => { setDraft(bot.name); setEditing(false); }} className="btn-ghost w-7 h-7 p-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-ink text-sm">{bot.name}</p>
            <button
              onClick={(e) => { e.stopPropagation(); setEditing(true); }}
              className="text-ink-subtle hover:text-ink transition-colors"
              title="Renombrar el bot"
            >
              <Pencil className="w-3 h-3" />
            </button>
            {bot.isDefault && (
              <span
                className="flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5"
                style={{ background: '#EEF2FF', color: '#4F46E5' }}
                title="Atiende las líneas que no tienen un bot elegido, incluidas las que se conecten de ahora en más"
              >
                <Star className="w-2.5 h-2.5" /> Predeterminado
              </span>
            )}
          </div>
        )}

        <p className="text-xs text-ink-muted mt-0.5">
          {bot.startInAiChat ? 'Arranca en chat con IA' : 'Arranca con el menú'} · {bot.nodeCount} {bot.nodeCount === 1 ? 'opción' : 'opciones'}
        </p>
        <p className="text-xs mt-1 flex items-start gap-1.5" style={{ color: lineNames.length ? '#128C7E' : 'var(--ink-subtle, #9CA3AF)' }}>
          <Phone className="w-3 h-3 mt-0.5 shrink-0 opacity-70" />
          <span>{lineNames.length ? `Atiende: ${lineNames.join(', ')}` : 'No atiende ninguna línea'}</span>
        </p>

        <div className="flex items-center gap-3 mt-2" onClick={(e) => e.stopPropagation()}>
          <button onClick={onDuplicate} disabled={busy} className="text-[11px] text-ink-subtle hover:text-ink transition-colors flex items-center gap-1">
            <Copy className="w-3 h-3" /> Duplicar
          </button>
          {!bot.isDefault && (
            <button onClick={onSetDefault} className="text-[11px] text-ink-subtle hover:text-ink transition-colors">
              Marcar como predeterminado
            </button>
          )}
          {!bot.isDefault && (
            <button onClick={onDelete} className="text-[11px] text-red-500 hover:text-red-600 transition-colors flex items-center gap-1">
              <Trash2 className="w-3 h-3" /> Eliminar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Info del negocio + modo de arranque de un bot ────────────────────────────

function AiCard({
  bot, hasOpenaiKey, onSaved,
}: { bot: BotSummary; hasOpenaiKey: boolean; onSaved: (patch: Partial<BotSummary>) => void }) {
  const [aiKnowledgeBase, setAiKnowledgeBase] = useState(bot.aiKnowledgeBase ?? '');
  const [savingAi, setSavingAi] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const startInAiChat = bot.startInAiChat;

  async function handleChangeMode(value: boolean) {
    if (value === startInAiChat || savingMode) return;
    onSaved({ startInAiChat: value });
    setSavingMode(true);
    try {
      await botsApi.update(bot.id, { startInAiChat: value });
      toast.success('Modo de bienvenida actualizado');
    } catch (err: any) {
      onSaved({ startInAiChat: !value });
      toast.error(err?.response?.data?.message || 'Error al actualizar el modo');
    } finally {
      setSavingMode(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSavingAi(true);
    try {
      const updated = await botsApi.update(bot.id, { aiKnowledgeBase });
      onSaved({ aiKnowledgeBase: updated.aiKnowledgeBase });
      toast.success('Información guardada');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al guardar');
    } finally {
      setSavingAi(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#F3E8FF' }}>
          <Sparkles className="w-3.5 h-3.5" style={{ color: '#9333EA' }} />
        </div>
        <label className="text-xs font-semibold text-ink">Información del negocio (modo IA)</label>
      </div>
      <p className="text-[11px] text-ink-subtle">
        Lo que escribas acá alimenta las respuestas de las opciones de tipo &quot;Modo IA&quot; de <strong>este bot</strong> — horarios,
        servicios, políticas, preguntas frecuentes. Cada bot tiene la suya: la del bot de ventas puede hablar de precios y la de
        soporte de garantías.
      </p>

      <div className="space-y-1.5 pt-1">
        <label className="text-xs font-semibold text-ink">¿Cómo arranca este bot con un cliente nuevo?</label>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={savingMode}
            onClick={() => handleChangeMode(false)}
            className={clsx('flex-1 text-sm', startInAiChat ? 'btn-secondary' : 'btn-primary')}
          >
            Menú de opciones
          </button>
          <button
            type="button"
            disabled={savingMode}
            onClick={() => handleChangeMode(true)}
            className={clsx('flex-1 text-sm', startInAiChat ? 'btn-primary' : 'btn-secondary')}
          >
            Chat con IA directo
          </button>
        </div>
        <p className="text-[11px] text-ink-subtle">
          {startInAiChat
            ? 'El cliente entra directo al chat de IA — el menú sigue disponible si escribe "menú".'
            : 'El cliente ve primero el menú de opciones.'}
        </p>
      </div>

      {startInAiChat && (!hasOpenaiKey || !aiKnowledgeBase.trim()) && (
        <div className="flex items-start gap-2 rounded-xl p-3 text-xs" style={{ background: '#FEF2F2', color: '#991B1B' }}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            Con &quot;Chat con IA directo&quot; activado, <strong>todas</strong> las conversaciones nuevas de las líneas de este bot van a
            derivar directo a un agente hasta que completes {!hasOpenaiKey && !aiKnowledgeBase.trim() ? 'la clave de OpenAI y la info del negocio' : !hasOpenaiKey ? 'la clave de OpenAI' : 'la info del negocio'} de acá abajo.
          </span>
        </div>
      )}

      {!hasOpenaiKey && (
        <div className="flex items-start gap-2 rounded-xl p-3 text-xs" style={{ background: '#FEF3C7', color: '#92400E' }}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            Todavía no tienes una clave de OpenAI conectada — sin eso, el modo IA siempre va a derivar a un agente. Configúrala en{' '}
            <Link href="/settings/ai" className="underline font-semibold">Configuración → IA</Link>. La clave es una sola para todos los bots.
          </span>
        </div>
      )}

      <textarea
        value={aiKnowledgeBase}
        onChange={(e) => setAiKnowledgeBase(e.target.value)}
        maxLength={AI_KNOWLEDGE_MAX_LENGTH}
        rows={8}
        className="input w-full text-sm"
        placeholder="Ej: Atendemos de lunes a sábado de 9am a 7pm. Hacemos reparaciones, cambio de batería y ajuste de correas. Tenemos sucursales en..."
      />
      <button type="submit" disabled={savingAi} className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed">
        {savingAi ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
        Guardar
      </button>
    </form>
  );
}
