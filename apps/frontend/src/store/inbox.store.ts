import { create } from 'zustand';
import { Conversation, Message, InternalNote } from '@/types';
import { conversationsApi, messagesApi, notesApi } from '@/lib/api';

interface InboxStore {
  conversations: Conversation[];
  selectedConversationId: string | null;
  messages: Message[];
  notes: InternalNote[];
  isLoadingConversations: boolean;
  isLoadingMessages: boolean;
  filter: { status?: string; search?: string };

  loadConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  setFilter: (filter: { status?: string; search?: string }) => void;
  updateConversation: (id: string, data: any) => Promise<void>;
  addMessage: (message: Message) => void;
  addNote: (note: InternalNote) => void;
  updateMessageStatus: (externalId: string, status: string) => void;
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
  filter: { status: 'OPEN' },

  loadConversations: async () => {
    set({ isLoadingConversations: true });
    try {
      const { filter } = get();
      const data = await conversationsApi.list(filter);
      set({ conversations: data });
    } finally {
      set({ isLoadingConversations: false });
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
    set((state) => ({
      conversations: state.conversations.map((c) => (c.id === id ? updated : c)),
    }));
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

  updateMessageStatus: (externalId, status) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.externalId === externalId ? { ...m, status: status as any } : m,
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
