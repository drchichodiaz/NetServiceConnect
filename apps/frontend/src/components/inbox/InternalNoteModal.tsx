'use client';
import { useState } from 'react';
import { X, StickyNote, Loader2 } from 'lucide-react';
import { notesApi } from '@/lib/api';
import { useInboxStore } from '@/store/inbox.store';
import { InternalNote } from '@/types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';

interface Props {
  conversationId: string;
  onClose: () => void;
}

export default function InternalNoteModal({ conversationId, onClose }: Props) {
  const [body,    setBody]    = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const { addNote, notes }    = useInboxStore();

  async function handleSave() {
    if (!body.trim()) return;
    setIsSaving(true);
    try {
      const note = await notesApi.create(conversationId, body.trim());
      addNote(note as InternalNote);
      setBody('');
      toast.success('Nota guardada');
    } catch {
      toast.error('Error al guardar nota');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.35)' }}>
      <div className="bg-white rounded-2xl shadow-float w-full max-w-md animate-pop" style={{ border: '1px solid var(--border)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <StickyNote className="w-4 h-4" style={{ color: '#F59E0B' }} />
            <h3 className="font-semibold text-ink text-sm">Notas internas</h3>
            {notes.length > 0 && (
              <span
                className="text-[10px] font-semibold rounded-full px-1.5 py-0.5"
                style={{ background: '#FEF3C7', color: '#92400E' }}
              >
                {notes.length}
              </span>
            )}
          </div>
          <button onClick={onClose} className="btn-ghost w-7 h-7 p-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Existing notes */}
        {notes.length > 0 && (
          <div className="px-5 pt-4 space-y-2.5 max-h-48 overflow-y-auto scrollbar-thin">
            {notes.map((note) => (
              <div
                key={note.id}
                className="rounded-xl p-3 text-sm animate-fade-in"
                style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-semibold" style={{ color: '#92400E' }}>
                    {note.user.name}
                  </span>
                  <span className="text-[10px]" style={{ color: '#B45309' }}>
                    {format(new Date(note.createdAt), "d MMM, HH:mm", { locale: es })}
                  </span>
                </div>
                <p className="text-ink-muted leading-relaxed whitespace-pre-wrap">{note.body}</p>
              </div>
            ))}
          </div>
        )}

        {/* Write area */}
        <div className="p-5">
          {notes.length === 0 && (
            <p className="text-xs text-ink-subtle mb-3">
              Las notas internas son privadas y no las ve el cliente.
            </p>
          )}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Escribe una nota para el equipo..."
            rows={3}
            className="w-full px-3.5 py-2.5 text-sm text-ink rounded-xl resize-none transition-all duration-150
                       focus:outline-none focus:ring-2"
            style={{
              border: '1px solid #FDE68A',
              background: '#FFFBEB',
              outline: 'none',
            }}
            onFocus={(e) => { e.target.style.boxShadow = '0 0 0 3px rgba(245,158,11,0.12)'; }}
            onBlur={(e)  => { e.target.style.boxShadow = 'none'; }}
          />

          <div className="flex gap-2 mt-3">
            <button onClick={onClose} className="btn-secondary flex-1">
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={!body.trim() || isSaving}
              className="flex-1 inline-flex items-center justify-center gap-2 font-medium py-2.5 px-4 rounded-xl text-sm
                         transition-all duration-150 disabled:opacity-50"
              style={{ background: '#F59E0B', color: 'white' }}
            >
              {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Guardar nota
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
