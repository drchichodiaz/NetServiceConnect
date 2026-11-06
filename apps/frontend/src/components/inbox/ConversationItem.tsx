'use client';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import clsx from 'clsx';
import { Phone, ArrowRightLeft, Clock } from 'lucide-react';
import { Conversation, accountLabel } from '@/types';

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

/** "12 min", "3 h", "2 d": cuanto lleva esperando, corto para que entre en la fila. */
export function waitLabel(since: string): string {
  const min = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 60000));
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.floor(min / 60)} h`;
  return `${Math.floor(min / 1440)} d`;
}

/** Pasada la primera hora sin respuesta, la conversacion se marca en rojo. */
export const WAIT_URGENT_MIN = 60;

function waitMinutes(since: string) {
  return (Date.now() - new Date(since).getTime()) / 60000;
}

/**
 * El cliente espera que le conteste una persona. Antes el unico indicador era el
 * contador de no leidos, que se apaga al abrir el chat aunque nadie haya contestado:
 * bastaba con mirar una conversacion para que dejara de verse pendiente.
 */
function WaitingBadge({ since }: { since: string }) {
  const urgent = waitMinutes(since) >= WAIT_URGENT_MIN;
  const label = waitLabel(since);
  return (
    <span
      className="flex items-center gap-1 text-[10px] font-bold rounded-full pl-1.5 pr-2 py-0.5 shrink-0"
      style={urgent ? { background: '#DC2626', color: '#fff' } : { background: '#FEF3C7', color: '#B45309' }}
      title={`Espera que le responda una persona hace ${label}`}
    >
      <Clock className="w-2.5 h-2.5 shrink-0" />
      Sin responder · {label}
    </span>
  );
}

export default function ConversationItem({ conversation, isSelected, onClick }: Props) {
  const { contact, lastMessageText, lastMessageAt, unreadCount, assignedUser, status, channelAccount, assignedAt, assignedSeenAt, waitingSince } = conversation;
  const name = contact.displayId || contact.name || contact.phone || 'Contacto';

  // Espera a una persona. Lo que atiende el bot no se marca: ya le contestaron.
  const waiting = status !== 'CLOSED' && waitingSince ? waitingSince : null;
  const urgent = !!waiting && waitMinutes(waiting) >= WAIT_URGENT_MIN;

  // Siempre, aunque la empresa tenga una sola línea — misma razón que en el encabezado.
  const showLine = !!channelAccount;

  // Le pasaron esta conversación y todavía no la abrió. Sin esta marca un traspaso es
  // invisible: la fila aparece en la bandeja igual que las demás y la conversación se
  // pierde. Se apaga sola cuando quien la tiene asignada la abre.
  const transferida =
    !!assignedAt && (!assignedSeenAt || new Date(assignedSeenAt) < new Date(assignedAt));

  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full flex items-start gap-3 px-4 py-3 text-left transition-all duration-150 relative',
        isSelected ? 'bg-green-50' : urgent ? 'bg-red-50/60 hover:bg-red-50' : 'hover:bg-surface-muted',
      )}
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      {/* Selected indicator */}
      {(isSelected || urgent) && (
        <span
          className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r-full"
          style={{ background: isSelected ? '#25D366' : '#DC2626' }}
        />
      )}

      <Avatar name={name} />

      <div className="flex-1 min-w-0">
        {/* Row 1: name + time */}
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className={clsx('text-sm truncate', unreadCount > 0 || transferida ? 'font-semibold text-ink' : 'font-medium text-ink')}>
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

        {/* Row 3: espera + traspaso + línea + assignee */}
        {(transferida || assignedUser || waiting || showLine) && (
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {waiting && <WaitingBadge since={waiting} />}
            {transferida && (
              <span
                className="flex items-center gap-1 text-[10px] rounded-full pl-1.5 pr-2 py-0.5 font-bold"
                style={{ background: '#FEF3C7', color: '#B45309' }}
                title="Te pasaron esta conversación y todavía no la abriste"
              >
                <ArrowRightLeft className="w-2.5 h-2.5 shrink-0" />
                Transferida
              </span>
            )}
            {showLine && (
              <span
                className="flex items-center gap-1 text-[10px] rounded-full pl-1.5 pr-2 py-0.5 font-semibold max-w-[140px]"
                style={{ background: '#EEF2FF', color: '#4F46E5' }}
                title={`Entró por ${accountLabel(channelAccount)}`}
              >
                <Phone className="w-2.5 h-2.5 shrink-0" />
                <span className="truncate">{accountLabel(channelAccount)}</span>
              </span>
            )}
            {assignedUser && (
              <span className="text-[10px] text-ink-subtle bg-surface-subtle rounded-full px-2 py-0.5 font-medium">
                {assignedUser.name.split(' ')[0]}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}
