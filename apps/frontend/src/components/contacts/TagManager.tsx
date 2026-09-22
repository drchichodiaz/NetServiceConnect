'use client';
import { useState } from 'react';
import { contactTagsApi } from '@/lib/api';
import { ContactTag } from '@/types';
import { useContactTags, reloadContactTags } from './TagPicker';
import { X, Pencil, Trash2, Check, Loader2, Tag as TagIcon } from 'lucide-react';
import toast from 'react-hot-toast';

/**
 * Renombrar, recolorear y borrar etiquetas. Es una ventana y no una pantalla en
 * Ajustes a propósito: se entra acá desde la lista de contactos, que es donde uno se
 * da cuenta de que hay dos etiquetas que querían decir lo mismo.
 *
 * Borrar una etiqueta no borra contactos: solo les saca esa etiqueta.
 */

const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#14b8a6'];

export default function TagManager({ onClose }: { onClose: () => void }) {
  const tags = useContactTags();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  async function save(tag: ContactTag, data: { name?: string; color?: string }) {
    setBusyId(tag.id);
    try {
      await contactTagsApi.update(tag.id, data);
      await reloadContactTags();
      setEditingId(null);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo guardar');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(tag: ContactTag) {
    const usedBy = tag.contactCount ?? 0;
    const warning = usedBy > 0
      ? `«${tag.name}» está en ${usedBy} contacto${usedBy === 1 ? '' : 's'}. Se la va a quitar a todos. Los contactos no se borran.`
      : `¿Borrar la etiqueta «${tag.name}»?`;
    if (!confirm(warning)) return;

    setBusyId(tag.id);
    try {
      await contactTagsApi.remove(tag.id);
      await reloadContactTags();
      toast.success('Etiqueta borrada');
    } catch {
      toast.error('No se pudo borrar');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl shadow-xl overflow-hidden"
        style={{ background: 'var(--surface)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <h2 className="text-sm font-bold text-ink">Etiquetas</h2>
            <p className="text-[11px] text-ink-muted mt-0.5">
              Se crean solas al escribirlas en un contacto. Acá se ordenan.
            </p>
          </div>
          <button onClick={onClose} className="text-ink-subtle hover:text-ink">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {tags.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <TagIcon className="w-7 h-7 text-ink-subtle mb-2" />
              <p className="text-sm font-medium text-ink mb-1">Todavía no hay etiquetas</p>
              <p className="text-xs text-ink-muted">
                Abrí un contacto y escribí una: se crea en el momento.
              </p>
            </div>
          ) : (
            tags.map((tag) => (
              <div
                key={tag.id}
                className="flex items-center gap-2 px-5 py-2.5"
                style={{ borderBottom: '1px solid var(--border)' }}
              >
                {editingId === tag.id ? (
                  <>
                    <input
                      value={draftName}
                      autoFocus
                      onChange={(e) => setDraftName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') save(tag, { name: draftName });
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="input flex-1 text-xs py-1"
                    />
                    <button
                      onClick={() => save(tag, { name: draftName })}
                      disabled={busyId === tag.id}
                      className="text-green-600 hover:text-green-700"
                    >
                      {busyId === tag.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    </button>
                    <button onClick={() => setEditingId(null)} className="text-ink-subtle hover:text-ink">
                      <X className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: tag.color }} />
                    <span className="flex-1 text-xs text-ink truncate">{tag.name}</span>
                    <span className="text-[10px] text-ink-subtle shrink-0">
                      {tag.contactCount ?? 0} contacto{(tag.contactCount ?? 0) === 1 ? '' : 's'}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      {PALETTE.map((color) => (
                        <button
                          key={color}
                          onClick={() => save(tag, { color })}
                          title="Cambiar color"
                          className="w-3 h-3 rounded-full ring-offset-1 hover:ring-2"
                          style={{ background: color, ...(tag.color === color ? { outline: '2px solid var(--ink)' } : {}) }}
                        />
                      ))}
                    </div>
                    <button
                      onClick={() => { setEditingId(tag.id); setDraftName(tag.name); }}
                      className="text-ink-subtle hover:text-ink shrink-0"
                      title="Renombrar"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => remove(tag)}
                      disabled={busyId === tag.id}
                      className="text-ink-subtle hover:text-red-600 shrink-0"
                      title="Borrar"
                    >
                      {busyId === tag.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
