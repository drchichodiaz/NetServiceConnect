import { create } from 'zustand';
import { Conversation, Message, InternalNote, WhatsAppAccount } from '@/types';
import { conversationsApi, messagesApi, notesApi, whatsappApi } from '@/lib/api';
import { useAuthStore } from './auth.store';

/**
 * Espeja los filtros que aplica el backend en ConversationsService.findAll, para
 * poder sacar una conversacion de la lista en el acto cuando deja de pertenecer a
 * la vista actual — sin esperar a recargar. Si se agrega un filtro nuevo alla,
 * tiene que agregarse aca: lo peor que pasa si se olvida es que la fila sobreviva
 * hasta la proxima recarga, que es el comportamiento que habia antes.
 */
function matchesFilter(
  conv: Conversation,
  filter: { status?: string; whatsappAccountId?: string },
): boolean {
  if (filter.status && conv.status !== filter.status) return false;
  if (filter.whatsappAccountId && conv.whatsappAccountId !== filter.whatsappAccountId) return false;

  // Un AGENTE solo ve lo suyo: si se reasigna a otro, desaparece de su bandeja.
  const user = useAuthStore.getState().user;
  if (user?.role === 'AGENT' && conv.assignedUserId !== user.id) return false;

  return true;
}

interface InboxStore {
  conversations: Conversation[];
  selectedConversationId: string | null;
  messages: Message[];
  notes: InternalNote[];
  isLoadingConversations: boolean;
  isLoadingMessages: boolean;
  // Lineas activas del tenant (una por sucursal) — alimentan el filtro del inbox.
  // Vacio o de largo 1 significa que no hay nada que filtrar y el selector se oculta.
  accounts: WhatsAppAccount[];
  filter: { status?: string; search?: string; whatsappAccountId?: string };

  loadConversations: (opts?: { silent?: boolean }) => Promise<void>;
  loadAccounts: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  setFilter: (filter: { status?: string; search?: string; whatsappAccountId?: string }) => void;
  updateConversation: (id: string, data: any) => Promise<void>;
  addMessage: (message: Message) => void;
  addNote: (note: InternalNote) => void;
  updateMessageStatus: (externalId: string, status: string, failureReason?: string | null) => void;
  updateConversationLastMessage: (opts: {
    conversationId: string;
    lastMessageText: string;
    lastMessageAt: string;
    contact?: any;
    unreadIncrement: number;
  }) => void;
}

export const useInboxStore = create<InboxStore>((set, get) => ({
  conversations: [],
  selectedConversationId: null,
  messages: [],
  notes: [],
  isLoadingConversations: false,
  isLoadingMessages: false,
  accounts: [],
  filter: { status: 'OPEN' },

  // `silent` recarga sin prender el spinner: se usa para los refrescos que dispara
  // el servidor (SSE), que ahora llegan en cada cambio de estado de cualquier agente.
  // Con el spinner, la lista parpadearia entera cada vez que alguien cierra un chat.
  loadConversations: async (opts) => {
    if (!opts?.silent) set({ isLoadingConversations: true });
    try {
      const { filter } = get();
      const data = await conversationsApi.list(filter);
      set({ conversations: data });
    } finally {
      if (!opts?.silent) set({ isLoadingConversations: false });
    }
  },

  // Falla en silencio a proposito: si no se pueden leer las lineas el inbox sigue
  // funcionando, solo que sin filtro por sucursal.
  loadAccounts: async () => {
    try {
      set({ accounts: await whatsappApi.listActiveAccounts() });
    } catch {
      set({ accounts: [] });
    }
  },

  selectConversation: async (id) => {
    set({ selectedConversationId: id, messages: [], notes: [], isLoadingMessages: true });
    try {
      const [msgData, noteData] = await Promise.all([
        messagesApi.list(id),
        notesApi.list(id),
      ]);
      set({ messages: msgData.messages, notes: noteData });
      await conversationsApi.markRead(id);
      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === id ? { ...c, unreadCount: 0 } : c,
        ),
      }));
    } finally {
      set({ isLoadingMessages: false });
    }
  },

  setFilter: (filter) => {
    set({ filter });
    get().loadConversations();
  },

  updateConversation: async (id, data) => {
    const updated = await conversationsApi.update(id, data);
    set((state) => {
      // Antes esto solo reemplazaba la fila: al cerrar una conversacion desde el
      // selector de estado, seguia listada en la pestaña "Abiertos" y abierta en
      // pantalla hasta que uno salia y volvia a entrar.
      if (matchesFilter(updated, state.filter)) {
        return { conversations: state.conversations.map((c) => (c.id === id ? updated : c)) };
      }

      const conversations = state.conversations.filter((c) => c.id !== id);
      // Si la que se fue de la lista era la que estabas viendo, el panel tiene que
      // cerrarse tambien — dejarlo abierto sobre una fila que ya no existe confunde.
      if (state.selectedConversationId === id) {
        return { conversations, selectedConversationId: null, messages: [], notes: [] };
      }
      return { conversations };
    });
  },

  addMessage: (message) => {
    set((state) => {
      // Evitar duplicados (el outbound ya se agrega desde ReplyBox)
      const exists = state.messages.some((m) => m.id === message.id);
      if (exists) return state;
      return { messages: [...state.messages, message] };
    });
  },

  addNote: (note) => {
    set((state) => ({ notes: [...state.notes, note] }));
  },

  updateMessageStatus: (externalId, status, failureReason) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.externalId === externalId
          ? { ...m, status: status as any, ...(failureReason !== undefined && { failureReason }) }
          : m,
      ),
    }));
  },

  updateConversationLastMessage: ({ conversationId, lastMessageText, lastMessageAt, contact, unreadIncrement }) => {
    set((state) => {
      const exists = state.conversations.find((c) => c.id === conversationId);

      if (!exists) {
        // Conversación nueva — recargar la lista completa
        get().loadConversations();
        return state;
      }

      // Mover la conversación al tope y actualizar datos
      const updated = state.conversations.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              lastMessageText,
              lastMessageAt,
              unreadCount: c.unreadCount + unreadIncrement,
              contact: contact ?? c.contact,
            }
          : c,
      );

      // Reordenar: la conversación actualizada va al tope
      const idx = updated.findIndex((c) => c.id === conversationId);
      if (idx > 0) {
        const [conv] = updated.splice(idx, 1);
        updated.unshift(conv);
      }

      return { conversations: updated };
    });
  },
}));
