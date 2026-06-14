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

  const conversation = conversations.find((c) => c.id === conversationId);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
