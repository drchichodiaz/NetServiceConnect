'use client';
import { useEffect, useState } from 'react';
import { Conversation, Tag as TagType } from '@/types';
import { useInboxStore } from '@/store/inbox.store';
import { conversationsApi, tagsApi } from '@/lib/api';
import {
  Phone, Mail, Tag, MessageSquare, StickyNote,
  CheckCircle, Clock, XCircle, ChevronRight, X, Plus,
  User, Calendar,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import clsx from 'clsx';

interface Props {
  conversation: Conversation;
  onClose: () => void;
}

const STATUS_CONFIG = {
  OPEN:    { label: 'Abierto',   color: '#25D366', bg: '#E8FBF0', Icon: CheckCircle },
  PENDING: { label: 'Pendiente', color: '#F59E0B', bg: '#FFFBEB', Icon: Clock },
  CLOSED:  { label: 'Cerrado',   color: '#9CA3AF', bg: '#F3F4F6', Icon: XCircle },
};

export default function ContactSidebar({ conversation, onClose }: Props) {
  const { notes, updateConversation } = useInboxStore();
  const { contact } = conversation;
  const displayName = contact.name || contact.phone;
  const initials = displayName.slice(0, 2).toUpperCase();

  const [history, setHistory] = useState<Conversation[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const [tagCatalog, setTagCatalog] = useState<TagType[]>([]);
  const [showTagMenu, setShowTagMenu] = useState(false);
  const [savingTags, setSavingTags] = useState(false);

  useEffect(() => {
    setLoadingHistory(true);
    conversationsApi
      .list({ contactId: contact.id })
      .then((data) => {
        // Excluir la conversación actual del historial
        setHistory(data.filter((c: Conversation) => c.id !== conversation.id));
      })
      .catch(() => setHistory([]))
      .finally(() => setLoadingHistory(false));
  }, [contact.id, conversation.id]);

  useEffect(() => {
    tagsApi.list().then(setTagCatalog).catch(() => setTagCatalog([]));
  }, []);

  const assignedTagIds = conversation.tags.map(({ tag }) => tag.id);
  const availableTags = tagCatalog.filter((t) => !assignedTagIds.includes(t.id));

  async function setTagIds(tagIds: string[]) {
    setSavingTags(true);
    try {
      await updateConversation(conversation.id, { tagIds });
    } catch {
      toast.error('Error al actualizar las etiquetas');
    } finally {
      setSavingTags(false);
    }
  }

  function handleAddTag(tagId: string) {
    setShowTagMenu(false);
    setTagIds([...assignedTagIds, tagId]);
  }

  function handleRemoveTag(tagId: string) {
    setTagIds(assignedTagIds.filter((id) => id !== tagId));
  }

  const status = STATUS_CONFIG[conversation.status] ?? STATUS_CONFIG.OPEN;

  return (
    <div
      className="flex flex-col h-full shrink-0 overflow-y-auto"
      style={{
        width: '272px',
        borderLeft: '1px solid var(--border)',
        background: 'var(--surface)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
          Perfil del contacto
        </span>
        <button
          onClick={onClose}
          className="btn-ghost w-6 h-6 p-0"
          title="Cerrar panel"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* ── Contacto ─────────────────────────────────── */}
        <div className="px-4 pt-5 pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
          {/* Avatar */}
          <div className="flex flex-col items-center mb-4">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-bold mb-3"
              style={{ background: '#E8FBF0', color: '#128C7E' }}
            >
              {initials}
            </div>
            <p className="font-semibold text-ink text-sm text-center">{displayName}</p>
            {contact.name && (
              <p className="text-xs text-ink-muted mt-0.5">{contact.phone}</p>
            )}
          </div>

          {/* Contact details */}
          <div className="space-y-2">
            <ContactRow icon={Phone} value={contact.phone} copyable />
            {contact.email && <ContactRow icon={Mail} value={contact.email} copyable />}
          </div>
        </div>

        {/* ── Esta conversación ─────────────────────────── */}
        <Section title="Esta conversación">
          <div className="space-y-2.5">
            {/* Status */}
            <InfoRow label="Estado">
              <span
                className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5"
                style={{ background: status.bg, color: status.color }}
              >
                <status.Icon className="w-3 h-3" />
                {status.label}
              </span>
            </InfoRow>

            {/* Assigned agent */}
            <InfoRow label="Agente">
              {conversation.assignedUser ? (
                <span className="flex items-center gap-1.5 text-xs text-ink">
                  <span
                    className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0"
                    style={{ background: '#E8FBF0', color: '#128C7E' }}
                  >
                    {conversation.assignedUser.name[0]}
                  </span>
                  {conversation.assignedUser.name}
                </span>
              ) : (
                <span className="text-xs text-ink-subtle italic">Sin asignar</span>
              )}
            </InfoRow>

            {/* Started */}
            <InfoRow label="Inicio">
              <span className="text-xs text-ink" title={format(new Date(conversation.createdAt), 'dd/MM/yyyy HH:mm')}>
                {formatDistanceToNow(new Date(conversation.createdAt), { addSuffix: true, locale: es })}
              </span>
            </InfoRow>

            {/* Message count */}
            {conversation._count && (
              <InfoRow label="Mensajes">
                <span className="text-xs text-ink">{conversation._count.messages}</span>
              </InfoRow>
            )}
          </div>
        </Section>

        {/* ── Etiquetas ─────────────────────────────────── */}
        <Section title="Etiquetas">
          <div className="flex flex-wrap items-center gap-1.5">
            {conversation.tags.map(({ tag }) => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full pl-2 pr-1 py-0.5 group"
                style={{ background: tag.color + '22', color: tag.color, border: `1px solid ${tag.color}44` }}
              >
                <Tag className="w-2.5 h-2.5" />
                {tag.name}
                <button
                  onClick={() => handleRemoveTag(tag.id)}
                  disabled={savingTags}
                  className="w-3.5 h-3.5 rounded-full flex items-center justify-center opacity-50 hover:opacity-100 transition-opacity"
                  title="Quitar etiqueta"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}

            <div className="relative">
              <button
                onClick={() => setShowTagMenu(!showTagMenu)}
                disabled={savingTags}
                className="w-5 h-5 rounded-full flex items-center justify-center text-ink-subtle hover:text-ink hover:bg-black/5 transition-colors"
                title="Agregar etiqueta"
              >
                <Plus className="w-3 h-3" />
              </button>

              {showTagMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowTagMenu(false)} />
                  <div
                    className="absolute left-0 top-full mt-1 bg-white rounded-xl shadow-float z-20 overflow-hidden animate-pop"
                    style={{ border: '1px solid var(--border)', minWidth: '160px', maxHeight: '220px', overflowY: 'auto' }}
                  >
                    {availableTags.length === 0 ? (
                      <p className="px-3.5 py-2.5 text-xs text-ink-subtle">
                        {tagCatalog.length === 0 ? 'Sin etiquetas creadas todavía' : 'Ya tiene todas las etiquetas'}
                      </p>
                    ) : (
                      availableTags.map((tag) => (
                        <button
                          key={tag.id}
                          onClick={() => handleAddTag(tag.id)}
                          className="flex items-center gap-2 w-full px-3.5 py-2.5 text-sm hover:bg-surface-muted transition-colors text-left"
                        >
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: tag.color }} />
                          <span className="text-ink truncate">{tag.name}</span>
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </Section>

        {/* ── Notas internas ────────────────────────────── */}
        {notes.length > 0 && (
          <Section title={`Notas (${notes.length})`}>
            <div className="space-y-2">
              {notes.map((note) => (
                <div
                  key={note.id}
                  className="rounded-lg p-2.5 text-xs"
                  style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}
                >
                  <p className="text-amber-800 leading-relaxed line-clamp-3">{note.body}</p>
                  <p className="text-amber-500 mt-1.5">
                    {note.user.name} · {formatDistanceToNow(new Date(note.createdAt), { addSuffix: true, locale: es })}
                  </p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Historial ─────────────────────────────────── */}
        <Section title="Historial del contacto">
          {loadingHistory ? (
            <div className="flex justify-center py-3">
              <div className="w-4 h-4 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />
            </div>
          ) : history.length === 0 ? (
            <p className="text-xs text-ink-subtle italic">Sin conversaciones anteriores</p>
          ) : (
            <div className="space-y-1.5">
              {history.slice(0, 5).map((conv) => {
                const s = STATUS_CONFIG[conv.status] ?? STATUS_CONFIG.OPEN;
                return (
                  <div
                    key={conv.id}
                    className="rounded-lg p-2.5 cursor-default"
                    style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className="text-[10px] font-semibold rounded-full px-1.5 py-0.5"
                        style={{ background: s.bg, color: s.color }}
                      >
                        {s.label}
                      </span>
                      <span className="text-[10px] text-ink-subtle">
                        {formatDistanceToNow(new Date(conv.createdAt), { addSuffix: true, locale: es })}
                      </span>
                    </div>
                    {conv.lastMessageText && (
                      <p className="text-xs text-ink-muted truncate">{conv.lastMessageText}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Section>

      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
      <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-3">{title}</p>
      {children}
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-ink-muted shrink-0">{label}</span>
      <div className="flex items-center gap-1 min-w-0">{children}</div>
    </div>
  );
}

function ContactRow({
  icon: Icon, value, copyable,
}: { icon: React.ElementType; value: string; copyable?: boolean }) {
  function copy() {
    navigator.clipboard.writeText(value);
  }

  return (
    <div className="flex items-center gap-2 text-xs text-ink">
      <Icon className="w-3.5 h-3.5 text-ink-muted shrink-0" />
      <span className="flex-1 truncate">{value}</span>
      {copyable && (
        <button
          onClick={copy}
          className="text-ink-subtle hover:text-ink transition-colors shrink-0"
          title="Copiar"
        >
          <ChevronRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
