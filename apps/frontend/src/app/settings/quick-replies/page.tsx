'use client';
import { useEffect, useRef, useState } from 'react';
import { quickRepliesApi } from '@/lib/api';
import { Plus, Trash2, Pencil, Zap, X, Check, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import EmojiPickerButton from '@/components/ui/EmojiPickerButton';

interface QuickReply {
  id: string;
  shortcut: string;
  title: string;
  body: string;
}

const EMPTY_FORM = { shortcut: '', title: '', body: '' };

export default function QuickRepliesPage() {
  const [replies,   setReplies]   = useState<QuickReply[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [showForm,  setShowForm]  = useState(false);
  const [editId,    setEditId]    = useState<string | null>(null);
  const [saving,    setSaving]    = useState(false);
  const [form,      setForm]      = useState(EMPTY_FORM);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  function insertEmoji(emoji: string) {
    const el = bodyRef.current;
    if (!el) { setForm((f) => ({ ...f, body: f.body + emoji })); return; }
    const start = el.selectionStart ?? form.body.length;
    const end   = el.selectionEnd   ?? form.body.length;
    const next  = form.body.slice(0, start) + emoji + form.body.slice(end);
    setForm((f) => ({ ...f, body: next }));
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + emoji.length, start + emoji.length);
    }, 0);
  }

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try { setReplies(await quickRepliesApi.list()); }
    catch { toast.error('Error al cargar respuestas rápidas'); }
    finally { setLoading(false); }
  }

  function openNew() {
    setForm(EMPTY_FORM);
    setEditId(null);
    setShowForm(true);
  }

  function openEdit(r: QuickReply) {
    setForm({ shortcut: r.shortcut, title: r.title, body: r.body });
    setEditId(r.id);
    setShowForm(true);
  }

  function cancel() {
    setShowForm(false);
    setEditId(null);
    setForm(EMPTY_FORM);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.shortcut.trim() || !form.title.trim() || !form.body.trim()) {
      toast.error('Todos los campos son obligatorios');
      return;
    }
    setSaving(true);
    try {
      if (editId) {
        const updated = await quickRepliesApi.update(editId, form);
        setReplies((prev) => prev.map((r) => (r.id === editId ? updated : r)));
        toast.success('Respuesta actualizada');
      } else {
        const created = await quickRepliesApi.create(form);
        setReplies((prev) => [...prev, created]);
        toast.success('Respuesta creada');
      }
      cancel();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar esta respuesta rápida?')) return;
    try {
      await quickRepliesApi.remove(id);
      setReplies((prev) => prev.filter((r) => r.id !== id));
      toast.success('Eliminada');
    } catch {
      toast.error('Error al eliminar');
    }
  }

  return (
    <div className="max-w-2xl mx-auto py-10 px-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between mb-8 gap-4">
        <div>
          <h1 className="text-xl font-bold text-ink mb-1" style={{ letterSpacing: '-0.02em' }}>
            Respuestas rápidas
          </h1>
          <p className="text-sm text-ink-muted">
            Escribe <kbd className="px-1.5 py-0.5 rounded text-xs bg-surface-muted border border-border font-mono">/</kbd> en el inbox para insertar una respuesta al instante.
          </p>
        </div>
        <button onClick={openNew} className="btn-primary flex items-center gap-2 shrink-0">
          <Plus className="w-4 h-4" />
          Nueva respuesta
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div
          className="card p-5 mb-6 animate-pop"
          style={{ border: '1px solid #BBF7D8' }}
        >
          <div className="flex items-center justify-between mb-4">
            <p className="font-semibold text-ink text-sm">
              {editId ? 'Editar respuesta' : 'Nueva respuesta rápida'}
            </p>
            <button onClick={cancel} className="btn-ghost w-7 h-7 p-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <form onSubmit={handleSave} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-ink">
                  Atajo <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted text-sm font-mono">/</span>
                  <input
                    value={form.shortcut}
                    onChange={(e) => setForm((f) => ({ ...f, shortcut: e.target.value.replace(/\s+/g, '-').toLowerCase() }))}
                    placeholder="saludo"
                    className="input w-full pl-7 font-mono text-sm"
                  />
                </div>
                <p className="text-[11px] text-ink-subtle">Sin espacios, solo minúsculas</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-ink">
                  Título <span className="text-red-400">*</span>
                </label>
                <input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Saludo inicial"
                  className="input w-full text-sm"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-ink flex items-center justify-between">
                Mensaje <span className="text-red-400">*</span>
                <EmojiPickerButton onEmojiSelect={insertEmoji} dropUp={false} />
              </label>
              <textarea
                ref={bodyRef}
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                placeholder="¡Hola! Gracias por contactarnos. ¿En qué podemos ayudarte hoy?"
                rows={3}
                className="input w-full text-sm resize-none"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={cancel} className="btn-ghost text-sm px-4">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="btn-primary flex items-center gap-2 text-sm"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                {editId ? 'Guardar cambios' : 'Crear respuesta'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-surface-muted animate-pulse" />
          ))}
        </div>
      ) : replies.length === 0 ? (
        <div
          className="card flex flex-col items-center justify-center py-16 text-center"
          style={{ border: '2px dashed var(--border)' }}
        >
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: '#E8FBF0' }}
          >
            <Zap className="w-6 h-6" style={{ color: '#25D366' }} />
          </div>
          <p className="font-semibold text-ink text-sm mb-1">Sin respuestas rápidas</p>
          <p className="text-xs text-ink-muted mb-4 max-w-xs">
            Crea respuestas predefinidas y úsalas en el inbox escribiendo <strong>/</strong>
          </p>
          <button onClick={openNew} className="btn-primary text-sm flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Crear primera respuesta
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {replies.map((r, i) => (
            <div
              key={r.id}
              className="card p-4 flex items-start gap-3 group hover:shadow-card-md transition-shadow animate-fade-in"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <span
                className="shrink-0 mt-0.5 text-[11px] font-mono font-semibold rounded px-1.5 py-0.5"
                style={{ background: '#E8FBF0', color: '#128C7E' }}
              >
                /{r.shortcut}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink truncate">{r.title}</p>
                <p className="text-xs text-ink-muted mt-0.5 line-clamp-2">{r.body}</p>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button
                  onClick={() => openEdit(r)}
                  className="btn-ghost w-7 h-7 p-0"
                  title="Editar"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(r.id)}
                  className="btn-ghost w-7 h-7 p-0 hover:text-red-500"
                  title="Eliminar"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
