'use client';
import { useEffect, useState } from 'react';
import { Conversation, ContactTag } from '@/types';
import { useInboxStore } from '@/store/inbox.store';
import { conversationsApi, contactsApi } from '@/lib/api';
import TagPicker, { reloadContactTags } from '@/components/contacts/TagPicker';
import {
  Phone, Mail, MessageSquare, StickyNote, Tag as TagIcon,
  CheckCircle, Clock, XCircle, ChevronRight, X,
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
  const { notes } = useInboxStore();
  const { contact } = conversation;
  const displayName = contact.displayId || contact.name || contact.phone || 'Contacto';
  const initials = displayName.slice(0, 2).toUpperCase();

  const [history, setHistory] = useState<Conversation[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Las etiquetas no vienen dentro de la conversacion: se piden aparte para no engordar
  // el payload de la bandeja, que trae decenas de conversaciones.
  const [tags, setTags] = useState<ContactTag[]>([]);

  useEffect(() => {
    let cancelled = false;
    contactsApi
      .get(contact.id)
      .then((c) => { if (!cancelled) setTags(c.tags ?? []); })
      .catch(() => { if (!cancelled) setTags([]); });
    return () => { cancelled = true; };
  }, [contact.id]);

  /**
   * Etiquetar desde la conversacion es el caso que mas importa: el agente se entera
   * aca de que la persona es mayorista, y si para anotarlo tiene que irse a Contactos,
   * no lo anota nunca.
   */
  async function saveTags(tagIds: string[]) {
    const previous = tags;
    try {
      const updated = await contactsApi.setTags(contact.id, tagIds);
      setTags(updated.tags ?? []);
      reloadContactTags().catch(() => {});
    } catch {
      toast.error('No se pudieron guardar las etiquetas');
      setTags(previous);
    }
  }

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
            {contact.name && contact.phone && (
              <p className="text-xs text-ink-muted mt-0.5">{contact.phone}</p>
            )}
          </div>

          {/* Contact details */}
          <div className="space-y-2">
            {/* Un contacto que llego por Instagram o Messenger no tiene telefono: la
                fila no se muestra en vez de quedar vacia. */}
            {contact.phone && <ContactRow icon={Phone} value={contact.phone} copyable />}
            {contact.email && <ContactRow icon={Mail} value={contact.email} copyable />}
          </div>

          <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
            <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <TagIcon className="w-3 h-3" />
              Etiquetas
            </p>
            <TagPicker value={tags.map((t) => t.id)} onChange={saveTags} />
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
