'use client';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import clsx from 'clsx';
import { Conversation } from '@/types';

interface Props {
  conversation: Conversation;
  isSelected: boolean;
  onClick: () => void;
}

function Avatar({ name }: { name: string }) {
  const initial = name[0]?.toUpperCase() ?? '?';
  const hues = [
    { bg: '#E8FBF0', color: '#128C7E' },
    { bg: '#EFF6FF', color: '#3B82F6' },
    { bg: '#FDF4FF', color: '#A855F7' },
    { bg: '#FFF7ED', color: '#F97316' },
    { bg: '#FFF1F2', color: '#F43F5E' },
  ];
  const idx   = name.charCodeAt(0) % hues.length;
  const style = hues[idx];

  return (
    <div
      className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-sm font-semibold"
      style={{ background: style.bg, color: style.color }}
    >
      {initial}
    </div>
  );
}

function SLABadge({ lastInboundAt }: { lastInboundAt: string }) {
  const diffMs  = Date.now() - new Date(lastInboundAt).getTime();
  const diffMin = Math.floor(diffMs / 60000);

  let label: string;
  if (diffMin < 60)       label = `${diffMin}min`;
  else if (diffMin < 1440) label = `${Math.floor(diffMin / 60)}h`;
  else                     label = `${Math.floor(diffMin / 1440)}d`;

  const color =
    diffMin < 30  ? { bg: '#E8FBF0', text: '#128C7E' } :
    diffMin < 120 ? { bg: '#FFFBEB', text: '#D97706' } :
                    { bg: '#FEF2F2', text: '#DC2626' };

  return (
    <span
      className="text-[10px] font-bold rounded-full px-1.5 py-0.5 shrink-0"
      style={{ background: color.bg, color: color.text }}
      title={`Esperando respuesta hace ${label}`}
    >
      {label}
    </span>
  );
}

export default function ConversationItem({ conversation, isSelected, onClick }: Props) {
  const { contact, lastMessageText, lastMessageAt, lastInboundAt, unreadCount, tags, assignedUser, status } = conversation;
  const name = contact.name || contact.phone;

  // Mostrar SLA solo en conversaciones abiertas/pendientes con mensajes entrantes sin responder
  const showSLA = status !== 'CLOSED' && !!lastInboundAt && unreadCount > 0;

  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full flex items-start gap-3 px-4 py-3 text-left transition-all duration-150 relative',
        isSelected ? 'bg-green-50' : 'hover:bg-surface-muted',
      )}
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      {/* Selected indicator */}
      {isSelected && (
        <span
          className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r-full"
          style={{ background: '#25D366' }}
        />
      )}

      <Avatar name={name} />

      <div className="flex-1 min-w-0">
        {/* Row 1: name + time */}
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className={clsx('text-sm truncate', unreadCount > 0 ? 'font-semibold text-ink' : 'font-medium text-ink')}>
            {name}
          </span>
          {lastMessageAt && (
            <span className="text-[11px] text-ink-subtle shrink-0">
              {formatDistanceToNow(new Date(lastMessageAt), { locale: es, addSuffix: false })}
            </span>
          )}
        </div>

        {/* Row 2: preview + unread badge */}
        <div className="flex items-center justify-between gap-2">
          <p className={clsx('text-xs truncate flex-1', unreadCount > 0 ? 'text-ink-muted' : 'text-ink-subtle')}>
            {lastMessageText || 'Sin mensajes'}
          </p>
          {unreadCount > 0 && (
            <span
              className="min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-white text-[10px] font-bold px-1 shrink-0"
              style={{ background: '#25D366' }}
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </div>

        {/* Row 3: tags + assignee + SLA */}
        {(tags.length > 0 || assignedUser || showSLA) && (
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {showSLA && <SLABadge lastInboundAt={lastInboundAt!} />}
            {assignedUser && (
              <span className="text-[10px] text-ink-subtle bg-surface-subtle rounded-full px-2 py-0.5 font-medium">
                {assignedUser.name.split(' ')[0]}
              </span>
            )}
            {tags.slice(0, 2).map(({ tag }) => (
              <span
                key={tag.id}
                className="text-[10px] rounded-full px-2 py-0.5 font-medium"
                style={{ background: `${tag.color}18`, color: tag.color }}
              >
                {tag.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}
