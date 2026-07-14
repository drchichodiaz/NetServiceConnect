'use client';
import { useEffect, useRef, useState } from 'react';
import { useInboxStore } from '@/store/inbox.store';
import ConversationHeader from './ConversationHeader';
import MessageBubble from './MessageBubble';
import ReplyBox from './ReplyBox';
import ContactSidebar from './ContactSidebar';

interface Props {
  conversationId: string;
}

export default function MessagePanel({ conversationId }: Props) {
  const { messages, notes, isLoadingMessages, conversations } = useInboxStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const lastScrolledConversationId = useRef<string | null>(null);

  const conversation = conversations.find((c) => c.id === conversationId);

  useEffect(() => {
    if (isLoadingMessages) return;
    const justOpened = lastScrolledConversationId.current !== conversationId;
    lastScrolledConversationId.current = conversationId;

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

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
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
