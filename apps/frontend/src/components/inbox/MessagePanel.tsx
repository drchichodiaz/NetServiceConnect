'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useInboxStore } from '@/store/inbox.store';
import ConversationHeader from './ConversationHeader';
import MessageBubble from './MessageBubble';
import ReplyBox from './ReplyBox';
import ContactSidebar from './ContactSidebar';

interface Props {
  conversationId: string;
}

export default function MessagePanel({ conversationId }: Props) {
  const {
    messages,
    isLoadingMessages,
    conversations,
    olderMessagesCursor,
    isLoadingOlderMessages,
    loadOlderMessages,
  } = useInboxStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Alto del historial antes de agregar los anteriores, para dejar a la vista el
  // mismo mensaje que se estaba leyendo en vez de saltar al principio.
  const heightBeforeOlder = useRef<number | null>(null);
  const lastMessageId = useRef<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const lastScrolledConversationId = useRef<string | null>(null);

  const conversation = conversations.find((c) => c.id === conversationId);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (heightBeforeOlder.current === null || !el) return;
    el.scrollTop += el.scrollHeight - heightBeforeOlder.current;
    heightBeforeOlder.current = null;
  }, [messages]);

  useEffect(() => {
    if (isLoadingMessages) return;
    const justOpened = lastScrolledConversationId.current !== conversationId;
    lastScrolledConversationId.current = conversationId;

    // Solo se baja al fondo al abrir o cuando llega un mensaje NUEVO. Si lo que cambio
    // fue que se agregaron los anteriores arriba, el fondo no se movio y no hay que ir.
    const newestId = messages[messages.length - 1]?.id ?? null;
    const newArrived = newestId !== lastMessageId.current;
    lastMessageId.current = newestId;
    if (!justOpened && !newArrived) return;

    // Al abrir/cambiar de conversación saltamos directo al final (sin animación):
    // con "smooth" la imagen/audio/video del último mensaje a veces todavía no
    // terminó de cargar y el scroll queda a mitad de camino en vez de al fondo.
    bottomRef.current?.scrollIntoView({ behavior: justOpened ? 'auto' : 'smooth' });

    if (justOpened) {
      const t = setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'auto' }), 200);
      return () => clearTimeout(t);
    }
  }, [messages, isLoadingMessages, conversationId]);

  // Cerrar sidebar al cambiar de conversación
  useEffect(() => {
    setSidebarOpen(false);
  }, [conversationId]);

  if (!conversation) return null;

  return (
    <div className="flex-1 flex h-full overflow-hidden">
      {/* ── Chat area ── */}
      <div className="flex-1 flex flex-col h-full bg-gray-50 min-w-0">
        <ConversationHeader
          conversation={conversation}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
        />

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
          {!isLoadingMessages && olderMessagesCursor && (
            <div className="flex justify-center pb-2">
              <button
                onClick={() => {
                  heightBeforeOlder.current = scrollRef.current?.scrollHeight ?? null;
                  loadOlderMessages().catch(() => {
                    heightBeforeOlder.current = null;
                  });
                }}
                disabled={isLoadingOlderMessages}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-white border border-border text-ink-muted hover:text-ink shadow-card disabled:opacity-60"
              >
                {isLoadingOlderMessages && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {isLoadingOlderMessages ? 'Cargando...' : 'Ver mensajes anteriores'}
              </button>
            </div>
          )}
          {isLoadingMessages ? (
            <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
              Cargando mensajes...
            </div>
          ) : messages.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
              Sin mensajes aún
            </div>
          ) : (
            messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))
          )}
          <div ref={bottomRef} />
        </div>

        <ReplyBox conversationId={conversationId} contact={conversation.contact} />
      </div>

      {/* ── Contact sidebar ── */}
      {sidebarOpen && (
        <ContactSidebar
          conversation={conversation}
          onClose={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}
