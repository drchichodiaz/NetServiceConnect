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
  whatsappAccountId?: string | null;
  whatsappAccount?: ConversationAccount | null;
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
  /** Motivo del fallo de entrega segun Meta, solo cuando status es FAILED. */
  failureReason?: string | null;
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

/** Una linea de WhatsApp del tenant. Con multi-numero hay una por sucursal. */
export interface WhatsAppAccount {
  id: string;
  wabaId: string;
  phoneNumberId?: string;
  phoneNumber?: string;
  displayName?: string;
  businessName?: string;
  /** Nombre operativo que le pone el admin, ej: "Sucursal Palermo". */
  label?: string | null;
  /** Linea usada para plantillas y para conversaciones salientes sin linea elegida. */
  isDefault?: boolean;
  sortOrder?: number;
  /**
   * Estado del numero segun Meta (CONNECTED = registrada y operativa). Distinto de
   * signupStatus, que es nuestro flujo de alta: una linea puede estar guardada pero
   * sin registrar en la Cloud API, y en ese estado no puede enviar.
   */
  platformStatus?: string | null;
  statusCheckedAt?: string | null;
  signupStatus: 'PENDING' | 'CONNECTED' | 'FAILED' | 'DISCONNECTED';
  isActive: boolean;
  webhookVerifyToken: string;
  createdAt: string;
  updatedAt: string;
}

/** Lo que trae una conversacion sobre su linea — alcanza para el badge del inbox. */
export interface ConversationAccount {
  id: string;
  label?: string | null;
  phoneNumber?: string | null;
}

/** Etiqueta a mostrar para una linea: el nombre que puso el admin, o el numero. */
export function accountLabel(account?: ConversationAccount | WhatsAppAccount | null): string {
  if (!account) return 'Sin línea';
  return account.label?.trim() || account.phoneNumber || 'Sin línea';
}

export interface AuthState {
  token: string | null;
  user: User | null;
}
