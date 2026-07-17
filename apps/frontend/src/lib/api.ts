import axios from 'axios';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

export const api = axios.create({ baseURL: BASE_URL });

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('access_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('access_token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }).then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data),
};

// ─── Conversations ─────────────────────────────────────────────────────────────

export const conversationsApi = {
  list: (params?: { status?: string; assignedUserId?: string; search?: string; contactId?: string }) =>
    api.get('/conversations', { params }).then((r) => r.data),
  get: (id: string) => api.get(`/conversations/${id}`).then((r) => r.data),
  update: (id: string, data: any) =>
    api.patch(`/conversations/${id}`, data).then((r) => r.data),
  markRead: (id: string) =>
    api.post(`/conversations/${id}/read`).then((r) => r.data),
};

// ─── Messages ─────────────────────────────────────────────────────────────────

export const messagesApi = {
  list: (conversationId: string, cursor?: string) =>
    api
      .get(`/conversations/${conversationId}/messages`, { params: { cursor } })
      .then((r) => r.data),
};

// ─── WhatsApp ─────────────────────────────────────────────────────────────────

export const whatsappApi = {
  send: (data: { conversationId: string; to: string; type: string; body?: string; mediaUrl?: string }) =>
    api.post('/whatsapp/send', data).then((r) => r.data),
  sendMedia: (data: { conversationId: string; to: string; type: string; caption?: string; file: File }) => {
    const form = new FormData();
    form.append('conversationId', data.conversationId);
    form.append('to', data.to);
    form.append('type', data.type);
    if (data.caption) form.append('caption', data.caption);
    form.append('file', data.file);
    return api.post('/whatsapp/send-media', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
  },
  startConversation: (data: {
    contactId?: string;
    phone?: string;
    name?: string;
    templateId: string;
    variables?: string[];
  }) => api.post('/whatsapp/start-conversation', data).then((r) => r.data),
  getAccount: () => api.get('/whatsapp/account').then((r) => r.data),
  // Embedded Signup: envía el code OAuth + session info — el backend hace el intercambio
  embeddedSignup: (data: { code: string; wabaId?: string; phoneNumberId?: string }) =>
    api.post('/whatsapp/embedded-signup', data).then((r) => r.data),
  // Activar número con PIN de 2FA si el signup lo requirió
  registerPhoneWithPin: (pin: string) =>
    api.post('/whatsapp/register-phone', { pin }).then((r) => r.data),
  connectDirect: (data: { accessToken: string; phoneNumberId: string; wabaId?: string }) =>
    api.post('/whatsapp/connect-direct', data).then((r) => r.data),
  disconnect: () => api.delete('/whatsapp/account').then((r) => r.data),
};

// ─── Notes ────────────────────────────────────────────────────────────────────

export const notesApi = {
  list: (conversationId: string) =>
    api.get(`/conversations/${conversationId}/notes`).then((r) => r.data),
  create: (conversationId: string, body: string) =>
    api.post(`/conversations/${conversationId}/notes`, { body }).then((r) => r.data),
  remove: (conversationId: string, noteId: string) =>
    api.delete(`/conversations/${conversationId}/notes/${noteId}`).then((r) => r.data),
};

// ─── AI ───────────────────────────────────────────────────────────────────────

export const aiApi = {
  suggest: (conversationId: string) =>
    api.post(`/conversations/${conversationId}/ai/suggest`).then((r) => r.data),
};

// ─── Users ────────────────────────────────────────────────────────────────────

export const usersApi = {
  list: () => api.get('/users').then((r) => r.data),
  create: (data: any) => api.post('/users', data).then((r) => r.data),
  update: (id: string, data: any) => api.patch(`/users/${id}`, data).then((r) => r.data),
};

// ─── Settings ─────────────────────────────────────────────────────────────────

export const settingsApi = {
  get: () => api.get('/settings').then((r) => r.data),
  update: (data: { openaiApiKey?: string; openaiModel?: string }) =>
    api.patch('/settings', data).then((r) => r.data),
};

// ─── Bot config (menú de WhatsApp) ─────────────────────────────────────────────

export const botConfigApi = {
  get: () => api.get('/bot-config').then((r) => r.data),
  update: (data: { orderStatusApiUrl?: string }) => api.patch('/bot-config', data).then((r) => r.data),
};

export const botStatsApi = {
  get: (period: 'today' | 'week' | 'month' = 'week') =>
    api.get('/bot-config/stats', { params: { period } }).then((r) => r.data),
};

// ─── Menu nodes (árbol configurable del menú de WhatsApp) ──────────────────────

export interface MenuNodeInput {
  parentId?: string | null;
  type?: 'MENU' | 'TEXT' | 'ORDER_LOOKUP' | 'AGENT';
  title: string;
  subtitle?: string;
  bodyText?: string;
  promptText?: string;
  active?: boolean;
}

export const menuNodesApi = {
  getTree: () => api.get('/menu-nodes').then((r) => r.data),
  create: (data: MenuNodeInput) => api.post('/menu-nodes', data).then((r) => r.data),
  update: (id: string, data: Partial<MenuNodeInput>) => api.patch(`/menu-nodes/${id}`, data).then((r) => r.data),
  move: (id: string, data: { parentId: string | null; orderedSiblingIds: string[] }) =>
    api.patch(`/menu-nodes/${id}/reparent`, data).then((r) => r.data),
  remove: (id: string) => api.delete(`/menu-nodes/${id}`).then((r) => r.data),
};

// ─── Stats ────────────────────────────────────────────────────────────────────

export const statsApi = {
  get: (period: 'today' | 'week' | 'month' = 'week') =>
    api.get('/stats', { params: { period } }).then((r) => r.data),
};

// ─── System Config ────────────────────────────────────────────────────────────

export const systemConfigApi = {
  get: () => api.get('/system-config').then((r) => r.data),
  update: (data: {
    metaAppId?: string;
    metaConfigId?: string;
    metaAppSecret?: string;
    metaVerifyToken?: string;
    metaApiVersion?: string;
    mediaStoragePath?: string;
  }) => api.patch('/system-config', data).then((r) => r.data),
};

// ─── Tenants (alta de empresas — solo operador de la plataforma) ──────────────

export const tenantsApi = {
  list: () => api.get('/tenants').then((r) => r.data),
  create: (data: {
    name: string;
    slug: string;
    plan?: string;
    adminName: string;
    adminEmail: string;
    adminPassword: string;
  }) => api.post('/tenants', data).then((r) => r.data),
};

// ─── Message Templates ─────────────────────────────────────────────────────────

export const templatesApi = {
  list: () => api.get('/whatsapp/templates').then((r) => r.data),
  create: (data: { name: string; language: string; category: string; bodyText: string; exampleValues?: string[] }) =>
    api.post('/whatsapp/templates', data).then((r) => r.data),
  refresh: (id: string) => api.patch(`/whatsapp/templates/${id}/refresh`).then((r) => r.data),
  remove: (id: string) => api.delete(`/whatsapp/templates/${id}`).then((r) => r.data),
};

// ─── Contacts ─────────────────────────────────────────────────────────────────

export interface ImportContactsResult {
  totalRows: number;
  created: number;
  skippedDuplicate: number;
  skippedInvalid: number;
  errors: { row: number; reason: string }[];
  truncatedErrors: boolean;
}

export const contactsApi = {
  list: (search?: string) =>
    api.get('/contacts', { params: search ? { search } : {} }).then((r) => r.data),
  get: (id: string) => api.get(`/contacts/${id}`).then((r) => r.data),
  update: (id: string, data: { name?: string; email?: string; company?: string }) =>
    api.patch(`/contacts/${id}`, data).then((r) => r.data),
  import: (file: File): Promise<ImportContactsResult> => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/contacts/import', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
  },
  // El link de descarga necesita el header de Authorization, así que no puede ser
  // un <a href> directo — se pide como blob y se dispara la descarga a mano.
  downloadImportTemplate: async () => {
    const res = await api.get('/contacts/import-template', { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla-contactos.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

// ─── Quick Replies ────────────────────────────────────────────────────────────

export const quickRepliesApi = {
  list: () => api.get('/quick-replies').then((r) => r.data),
  create: (data: { shortcut: string; title: string; body: string }) =>
    api.post('/quick-replies', data).then((r) => r.data),
  update: (id: string, data: Partial<{ shortcut: string; title: string; body: string }>) =>
    api.patch(`/quick-replies/${id}`, data).then((r) => r.data),
  remove: (id: string) => api.delete(`/quick-replies/${id}`).then((r) => r.data),
};

// ─── Tags ─────────────────────────────────────────────────────────────────────

export const tagsApi = {
  list: () => api.get('/tags').then((r) => r.data),
  create: (data: { name: string; color?: string }) =>
    api.post('/tags', data).then((r) => r.data),
};
