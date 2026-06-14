'use client';
import { format } from 'date-fns';
import { Check, CheckCheck, Clock, AlertCircle, Image, Mic, FileText } from 'lucide-react';
import { Message } from '@/types';
import clsx from 'clsx';

interface Props { message: Message; }

function DeliveryIcon({ status }: { status: string }) {
  if (status === 'READ')      return <CheckCheck className="w-3.5 h-3.5" style={{ color: '#60A5FA' }} />;
  if (status === 'DELIVERED') return <CheckCheck className="w-3.5 h-3.5 opacity-50" />;
  if (status === 'SENT')      return <Check className="w-3.5 h-3.5 opacity-50" />;
  if (status === 'FAILED')    return <AlertCircle className="w-3.5 h-3.5" style={{ color: '#F87171' }} />;
  return <Clock className="w-3.5 h-3.5 opacity-30" />;
}

function MediaBadge({ type }: { type: string }) {
  const map: Record<string, { icon: any; label: string }> = {
    IMAGE:    { icon: Image,    label: 'Imagen' },
    AUDIO:    { icon: Mic,      label: 'Audio' },
    DOCUMENT: { icon: FileText, label: 'Documento' },
    VIDEO:    { icon: Image,    label: 'Video' },
  };
  const item = map[type];
  if (!item) return null;
  const Icon = item.icon;
  return (
    <div className="flex items-center gap-1.5 mb-1 opacity-80">
      <Icon className="w-3.5 h-3.5" />
      <span className="text-xs">{item.label}</span>
    </div>
  );
}

export default function MessageBubble({ message }: Props) {
  const isOut = message.direction === 'OUTBOUND';

  return (
    <div className={clsx('flex mb-1', isOut ? 'justify-end' : 'justify-start')}>
      <div
        className={clsx(
          'max-w-[72%] px-3.5 py-2 rounded-2xl text-sm leading-relaxed shadow-card',
          isOut ? 'rounded-br-sm' : 'rounded-bl-sm',
        )}
        style={
          isOut
            ? { background: '#DCF8C6', color: '#0F1117' }
            : { background: '#FFFFFF', color: '#1A1D23', border: '1px solid var(--border)' }
        }
      >
        {/* Agent name for outbound */}
        {isOut && message.sender && (
          <p className="text-[10px] font-semibold mb-1" style={{ color: '#128C7E' }}>
            {message.sender.name}
          </p>
        )}

        {message.type !== 'TEXT' && <MediaBadge type={message.type} />}

        {message.body && (
          <p className="whitespace-pre-wrap break-words">{message.body}</p>
        )}

        <div className={clsx('flex items-center gap-1 mt-1', isOut ? 'justify-end' : 'justify-end')}>
          <span className="text-[11px] opacity-60">
            {format(new Date(message.createdAt), 'HH:mm')}
          </span>
          {isOut && <DeliveryIcon status={message.status} />}
        </div>
      </div>
    </div>
  );
}
