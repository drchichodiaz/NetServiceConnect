import { useEffect, useRef } from 'react';
import { useInboxStore } from '@/store/inbox.store';
import { getToken } from '@/lib/auth';
import { Message } from '@/types';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

function requestNotificationPermission() {
  if (typeof window === 'undefined') return;
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function showNotification(title: string, body: string, onClick?: () => void) {
  if (typeof window === 'undefined') return;
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return; // solo si la pestaña está en background

  const n = new Notification(title, {
    body,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: 'netservice-msg', // agrupa notificaciones del mismo origen
  });

  if (onClick) n.onclick = () => { window.focus(); onClick(); };
}

export function useRealtimeEvents() {
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    requestNotificationPermission();

    const token = getToken();
    if (!token) return;

    const es = new EventSource(`${API}/events?token=${token}`);
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'heartbeat') return;

        const store = useInboxStore.getState();

        if (data.type === 'new_message') {
          const { message, conversationId, contact, lastMessageText, lastMessageAt } = data.payload;

          if (message.direction === 'INBOUND') {
            // Mostrar notificación del OS si la pestaña está en background
            const contactName = contact?.name || contact?.phone || 'Contacto';
            showNotification(
              `💬 ${contactName}`,
              lastMessageText || 'Nuevo mensaje',
              () => store.selectConversation(conversationId),
            );
          }

          if (message.direction === 'INBOUND' && conversationId === store.selectedConversationId) {
            store.addMessage(message as Message);
          }

          store.updateConversationLastMessage({
            conversationId,
            lastMessageText,
            lastMessageAt,
            contact,
            unreadIncrement:
              message.direction === 'INBOUND' && conversationId !== store.selectedConversationId
                ? 1
                : 0,
          });
        }

        if (data.type === 'message_status') {
          store.updateMessageStatus(data.payload.externalId, data.payload.status);
        }

        if (data.type === 'conversation_updated') {
          store.loadConversations();
        }
      } catch {
        // JSON inválido — ignorar
      }
    };

    es.onerror = () => {
      // EventSource reconecta automáticamente
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);
}
