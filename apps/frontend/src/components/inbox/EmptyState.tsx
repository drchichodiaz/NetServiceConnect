import { MessageSquare } from 'lucide-react';

export default function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-surface-muted">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
        style={{ background: '#F0F1F5', border: '1px solid var(--border)' }}
      >
        <MessageSquare className="w-7 h-7 text-ink-ghost" />
      </div>
      <h3 className="font-semibold text-ink text-sm mb-1">
        Selecciona una conversacion
      </h3>
      <p className="text-xs text-ink-subtle max-w-[220px] text-center leading-relaxed">
        Elige una conversacion de la lista para ver los mensajes y responder.
      </p>
    </div>
  );
}
