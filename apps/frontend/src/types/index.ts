export type UserRole = 'ADMIN' | 'SUPERVISOR' | 'AGENT';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isSuperAdmin?: boolean;
  tenantId: string;
  tenant: Tenant;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
}

export interface Contact {
  id: string;
  tenantId: string;
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  avatarUrl?: string;
  createdAt?: string;
  _count?: { conversations: number };
}

export type ConversationStatus = 'OPEN' | 'PENDING' | 'CLOSED';

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface ConversationTag {
  tag: Tag;
}

export interface Conversation {
  id: string;
  tenantId: string;
  contactId: string;
  contact: Contact;
  assignedUserId?: string;
  assignedUser?: { id: string; name: string };
  status: ConversationStatus;
  lastMessageAt?: string;
  lastMessageText?: string;
  lastInboundAt?: string;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
  tags: ConversationTag[];
  _count?: { messages: number; notes: number };
}

export type MessageDirection = 'INBOUND' | 'OUTBOUND';
export type MessageType = 'TEXT' | 'IMAGE' | 'AUDIO' | 'DOCUMENT' | 'VIDEO' | 'STICKER';
export type MessageStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface Message {
  id: string;
  conversationId: string;
  senderId?: string;
  sender?: { id: string; name: string };
  direction: MessageDirection;
  type: MessageType;
  body?: string;
  mediaUrl?: string;
  mediaType?: string;
  status: MessageStatus;
  externalId?: string;
  createdAt: string;
}

export interface InternalNote {
  id: string;
  conversationId: string;
  userId: string;
  user: { id: string; name: string };
  body: string;
  createdAt: string;
}

export interface WhatsAppAccount {
  id: string;
  wabaId: string;
  phoneNumber?: string;
  displayName?: string;
  businessName?: string;
  signupStatus: 'PENDING' | 'CONNECTED' | 'FAILED' | 'DISCONNECTED';
  isActive: boolean;
  webhookVerifyToken: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthState {
  token: string | null;
  user: User | null;
}
