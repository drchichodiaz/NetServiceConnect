'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { contactsApi, conversationsApi, templatesApi, whatsappApi, ImportContactsResult } from '@/lib/api';
import { useInboxStore } from '@/store/inbox.store';
import { Contact, Conversation } from '@/types';
import {
  Search, Phone, Mail, Building2, MessageSquare,
  Pencil, Check, X, ChevronRight, Users, MessageCirclePlus, Loader2,
  Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle2,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import clsx from 'clsx';

interface Template {
  id: string;
  name: string;
  language: string;
  category: string;
  bodyText: string;
  variableCount: number;
  status: string;
}

const STATUS_CONFIG = {
  OPEN:    { label: 'Abierto',   color: '#25D366', bg: '#E8FBF0' },
  PENDING: { label: 'Pendiente', color: '#F59E0B', bg: '#FFFBEB' },
  CLOSED:  { label: 'Cerrado',   color: '#9CA3AF', bg: '#F3F4F6' },
};

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const hues = [
    { bg: '#E8FBF0', color: '#128C7E' },
    { bg: '#EFF6FF', color: '#3B82F6' },
    { bg: '#FDF4FF', color: '#A855F7' },
    { bg: '#FFF7ED', color: '#F97316' },
    { bg: '#FFF1F2', color: '#F43F5E' },
  ];
  const s   = hues[(name.charCodeAt(0) || 0) % hues.length];
  const sz  = size === 'lg' ? 'w-14 h-14 text-xl' : size === 'sm' ? 'w-7 h-7 text-xs' : 'w-10 h-10 text-sm';
  return (
    <div className={`${sz} rounded-full flex items-center justify-center font-semibold shrink-0`}
      style={{ background: s.bg, color: s.color }}>
      {name[0]?.toUpperCase() ?? '?'}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ContactsPage() {
  const router = useRouter();
  const [contacts,  setContacts]  = useState<Contact[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');
  const [selected,  setSelected]  = useState<Contact | null>(null);
  const [history,   setHistory]   = useState<Conversation[]>([]);
  const [histLoad,  setHistLoad]  = useState(false);

  // Edit mode
  const [editing,   setEditing]   = useState(false);
  const [editForm,  setEditForm]  = useState({ name: '', email: '', company: '' });
  const [saving,    setSaving]    = useState(false);

  // Nueva conversación
  const [showNewConv, setShowNewConv] = useState(false);
  const [newConvContact, setNewConvContact] = useState<Contact | null>(null);

  // Importar contactos
  const [showImport, setShowImport] = useState(false);

  const load = useCallback(async (q?: string) => {
    setLoading(true);
    try { setContacts(await contactsApi.list(q)); }
    catch { toast.error('Error al cargar contactos'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => load(search || undefined), 300);
    return () => clearTimeout(t);
  }, [search, load]);

  async function selectContact(c: Contact) {
    setSelected(c);
    setEditing(false);
    setHistory([]);
    setHistLoad(true);
    try {
      const data = await conversationsApi.list({ contactId: c.id });
      setHistory(data);
    } catch { /* silencioso */ }
    finally { setHistLoad(false); }
  }

  function startEdit() {
    if (!selected) return;
    setEditForm({
      name:    selected.name    ?? '',
      email:   selected.email   ?? '',
      company: selected.company ?? '',
    });
    setEditing(true);
  }

  async function saveEdit() {
    if (!selected) return;
    setSaving(true);
    try {
      const updated = await contactsApi.update(selected.id, editForm);
      setSelected({ ...selected, ...updated });
      setContacts((prev) => prev.map((c) => c.id === selected.id ? { ...c, ...updated } : c));
      setEditing(false);
      toast.success('Contacto actualizado');
    } catch {
      toast.error('Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  async function handleConversationStarted(conversationId: string) {
    setShowNewConv(false);
    setNewConvContact(null);
    await useInboxStore.getState().loadConversations();
    useInboxStore.getState().selectConversation(conversationId);
    router.push('/inbox');
  }

  const displayName = selected ? (selected.name || selected.phone) : '';

  return (
    <div className="flex h-full">

      {/* ── Contact list ─────────────────────────────────────────────── */}
      <div
        className="flex flex-col shrink-0"
        style={{ width: '320px', borderRight: '1px solid var(--border)', background: 'var(--surface)' }}
      >
        {/* Header */}
        <div className="px-4 pt-5 pb-3 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-base font-bold text-ink" style={{ letterSpacing: '-0.02em' }}>
              Contactos
            </h1>
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-muted bg-surface-muted rounded-full px-2 py-0.5 font-medium">
                {contacts.length}
              </span>
              <button
                onClick={() => setShowImport(true)}
                title="Importar contactos desde Excel"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-subtle hover:text-ink hover:bg-black/5"
              >
                <Upload className="w-4 h-4" />
              </button>
              <button
                onClick={() => { setNewConvContact(null); setShowNewConv(true); }}
                title="Nueva conversación con un contacto nuevo"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-subtle hover:text-ink hover:bg-black/5"
              >
                <MessageCirclePlus className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre, teléfono..."
              className="input w-full pl-9 text-sm"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-4 space-y-3 py-2">
              {[1,2,3,4,5].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-surface-muted animate-pulse shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-24 rounded bg-surface-muted animate-pulse" />
                    <div className="h-2.5 w-16 rounded bg-surface-muted animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : contacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <Users className="w-8 h-8 text-ink-subtle mb-3" />
              <p className="text-sm font-medium text-ink mb-1">Sin contactos</p>
              <p className="text-xs text-ink-muted">Los contactos aparecen automáticamente cuando recibes mensajes</p>
            </div>
          ) : (
            contacts.map((c) => {
              const name = c.name || c.phone;
              const isSelected = selected?.id === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => selectContact(c)}
                  className={clsx(
                    'w-full flex items-center gap-3 px-4 py-3 text-left transition-all',
                    isSelected ? 'bg-green-50' : 'hover:bg-surface-muted',
                  )}
                  style={{ borderBottom: '1px solid var(--border)' }}
                >
                  {isSelected && (
                    <span className="absolute left-0 w-[3px] h-10 rounded-r-full" style={{ background: '#25D366' }} />
                  )}
                  <Avatar name={name} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink truncate">{name}</p>
                    <p className="text-xs text-ink-muted truncate">
                      {c.company ? `${c.company} · ` : ''}{c.phone}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {(c._count?.conversations ?? 0) > 0 && (
                      <span className="text-[10px] text-ink-subtle font-medium flex items-center gap-0.5">
                        <MessageSquare className="w-2.5 h-2.5" />
                        {c._count!.conversations}
                      </span>
                    )}
                    <ChevronRight className="w-3.5 h-3.5 text-ink-subtle" />
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Contact detail ───────────────────────────────────────────── */}
      {selected ? (
        <div className="flex-1 overflow-y-auto bg-gray-50">
          <div className="max-w-2xl mx-auto py-8 px-6">

            {/* Profile header */}
            <div className="card p-6 mb-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <Avatar name={displayName} size="lg" />
                  <div>
                    <h2 className="text-lg font-bold text-ink" style={{ letterSpacing: '-0.02em' }}>
                      {displayName}
                    </h2>
                    {selected.company && (
                      <p className="text-sm text-ink-muted">{selected.company}</p>
                    )}
                    <p className="text-xs text-ink-subtle mt-0.5">
                      Contacto desde {selected.createdAt
                        ? format(new Date(selected.createdAt), 'MMM yyyy', { locale: es })
                        : '—'}
                    </p>
                  </div>
                </div>
                {!editing && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setNewConvContact(selected); setShowNewConv(true); }}
                      className="btn-ghost flex items-center gap-1.5 text-xs"
                    >
                      <MessageCirclePlus className="w-3.5 h-3.5" />
                      Nueva conversación
                    </button>
                    <button onClick={startEdit} className="btn-ghost flex items-center gap-1.5 text-xs">
                      <Pencil className="w-3.5 h-3.5" />
                      Editar
                    </button>
                  </div>
                )}
              </div>

              {/* Info rows or edit form */}
              {editing ? (
                <div className="mt-5 space-y-3">
                  <EditField label="Nombre" value={editForm.name}
                    onChange={(v) => setEditForm((f) => ({ ...f, name: v }))}
                    placeholder="Nombre del contacto" />
                  <EditField label="Email" value={editForm.email}
                    onChange={(v) => setEditForm((f) => ({ ...f, email: v }))}
                    placeholder="email@ejemplo.com" type="email" />
                  <EditField label="Empresa" value={editForm.company}
                    onChange={(v) => setEditForm((f) => ({ ...f, company: v }))}
                    placeholder="Nombre de la empresa" />
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={saveEdit}
                      disabled={saving}
                      className="btn-primary text-sm flex items-center gap-1.5"
                    >
                      <Check className="w-3.5 h-3.5" />
                      {saving ? 'Guardando...' : 'Guardar'}
                    </button>
                    <button onClick={() => setEditing(false)} className="btn-ghost text-sm flex items-center gap-1.5">
                      <X className="w-3.5 h-3.5" />
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <InfoCell icon={Phone}   label="Teléfono" value={selected.phone} />
                  <InfoCell icon={Mail}    label="Email"    value={selected.email} />
                  <InfoCell icon={Building2} label="Empresa" value={selected.company} />
                  <InfoCell icon={MessageSquare} label="Conversaciones"
                    value={String(selected._count?.conversations ?? history.length)} />
                </div>
              )}
            </div>

            {/* Conversation history */}
            <div className="card overflow-hidden">
              <div className="px-5 py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
                <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
                  Historial de conversaciones
                </p>
              </div>

              {histLoad ? (
                <div className="px-5 py-6 space-y-3">
                  {[1,2,3].map((i) => <div key={i} className="h-12 rounded-lg bg-surface-muted animate-pulse" />)}
                </div>
              ) : history.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-ink-muted">Sin conversaciones</div>
              ) : (
                <div className="divide-y divide-border">
                  {history.map((conv) => {
                    const s = STATUS_CONFIG[conv.status] ?? STATUS_CONFIG.OPEN;
                    return (
                      <div key={conv.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-surface-muted transition-colors">
                        <span
                          className="text-[10px] font-semibold rounded-full px-2 py-0.5 shrink-0"
                          style={{ background: s.bg, color: s.color }}
                        >
                          {s.label}
                        </span>
                        <p className="text-sm text-ink-muted truncate flex-1">
                          {conv.lastMessageText || 'Sin mensajes'}
                        </p>
                        <span className="text-xs text-ink-subtle shrink-0">
                          {conv.lastMessageAt
                            ? formatDistanceToNow(new Date(conv.lastMessageAt), { addSuffix: true, locale: es })
                            : '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ background: '#E8FBF0' }}
            >
              <Users className="w-7 h-7" style={{ color: '#25D366' }} />
            </div>
            <p className="font-semibold text-ink text-sm mb-1">Selecciona un contacto</p>
            <p className="text-xs text-ink-muted">Ver detalles, editar información e historial</p>
          </div>
        </div>
      )}

      {showNewConv && (
        <NewConversationModal
          contact={newConvContact}
          onClose={() => { setShowNewConv(false); setNewConvContact(null); }}
          onSent={handleConversationStarted}
        />
      )}

      {showImport && (
        <ImportContactsModal
          onClose={() => setShowImport(false)}
          onImported={() => load(search || undefined)}
        />
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function InfoCell({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value?: string | null }) {
  return (
    <div className="flex items-start gap-2.5 p-3 rounded-xl" style={{ background: 'var(--surface-muted)' }}>
      <Icon className="w-3.5 h-3.5 text-ink-muted mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] text-ink-subtle uppercase tracking-wider font-semibold mb-0.5">{label}</p>
        <p className="text-sm text-ink truncate">{value || <span className="text-ink-subtle italic text-xs">Sin datos</span>}</p>
      </div>
    </div>
  );
}

function EditField({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-ink-muted">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input w-full text-sm"
      />
    </div>
  );
}

function NewConversationModal({ contact, onClose, onSent }: {
  contact: Contact | null;
  onClose: () => void;
  onSent: (conversationId: string) => void;
}) {
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [name,  setName]  = useState(contact?.name ?? '');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [templateId, setTemplateId] = useState('');
  const [variables, setVariables] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    templatesApi.list()
      .then((all: Template[]) => setTemplates(all.filter((t) => t.status === 'APPROVED')))
      .catch(() => toast.error('Error al cargar plantillas'))
      .finally(() => setLoadingTemplates(false));
  }, []);

  const selectedTemplate = templates.find((t) => t.id === templateId) || null;

  function handleSelectTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((tpl) => tpl.id === id);
    setVariables(t ? Array(t.variableCount).fill('') : []);
  }

  async function handleSend() {
    if (!templateId) { toast.error('Elige una plantilla'); return; }
    if (!contact && !phone.trim()) { toast.error('Ingresa el teléfono del contacto'); return; }

    setSending(true);
    try {
      const result = await whatsappApi.startConversation({
        contactId: contact?.id,
        phone: contact ? undefined : phone.trim(),
        name: contact ? undefined : (name.trim() || undefined),
        templateId,
        variables,
      });
      toast.success('Conversación iniciada');
      onSent(result.conversation.id);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al iniciar la conversación');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="card w-full max-w-md p-5 animate-pop">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold text-ink">
            {contact ? `Nueva conversación con ${contact.name || contact.phone}` : 'Nueva conversación'}
          </p>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-subtle hover:bg-black/5">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          {!contact && (
            <>
              <input
                required placeholder="Teléfono (con código de país)" value={phone}
                onChange={(e) => setPhone(e.target.value)} className="input w-full"
              />
              <input
                placeholder="Nombre (opcional)" value={name}
                onChange={(e) => setName(e.target.value)} className="input w-full"
              />
            </>
          )}

          {loadingTemplates ? (
            <div className="flex items-center gap-2 text-sm text-ink-muted py-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Cargando plantillas...
            </div>
          ) : templates.length === 0 ? (
            <p className="text-sm text-ink-muted py-2">
              No tienes plantillas aprobadas todavía. Crea una en Settings → Plantillas y espera su aprobación de Meta.
            </p>
          ) : (
            <select value={templateId} onChange={(e) => handleSelectTemplate(e.target.value)} className="input w-full">
              <option value="">Elige una plantilla...</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}

          {selectedTemplate && (
            <div className="rounded-lg p-3 text-xs text-ink-muted" style={{ background: 'var(--surface-muted)' }}>
              {selectedTemplate.bodyText}
            </div>
          )}

          {variables.map((v, i) => (
            <input
              key={i}
              placeholder={`Variable {{${i + 1}}}`}
              value={v}
              onChange={(e) => setVariables((prev) => prev.map((val, idx) => (idx === i ? e.target.value : val)))}
              className="input w-full"
            />
          ))}
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
          <button onClick={handleSend} disabled={sending || !templateId} className="btn-primary flex-1">
            {sending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportContactsModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [result, setResult] = useState<ImportContactsResult | null>(null);

  async function handleDownloadTemplate() {
    setDownloadingTemplate(true);
    try {
      await contactsApi.downloadImportTemplate();
    } catch {
      toast.error('Error al descargar la plantilla');
    } finally {
      setDownloadingTemplate(false);
    }
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    try {
      const res = await contactsApi.import(file);
      setResult(res);
      if (res.created > 0) onImported();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al importar el archivo');
    } finally {
      setUploading(false);
    }
  }

  function handleClose() {
    if (result && result.created > 0) onImported();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="card w-full max-w-md p-5 animate-pop">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold text-ink">Importar contactos</p>
          <button onClick={handleClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-subtle hover:bg-black/5">
            <X className="w-4 h-4" />
          </button>
        </div>

        {!result ? (
          <div className="space-y-4">
            <p className="text-xs text-ink-muted">
              Sube un archivo .xlsx o .csv con las columnas <strong>Nombre</strong>, <strong>Telefono</strong>, <strong>Email</strong> y <strong>Empresa</strong> (solo el teléfono es obligatorio). El teléfono debe incluir el código de país, por ejemplo <code className="text-[11px]">50760000000</code>.
            </p>

            <button
              onClick={handleDownloadTemplate}
              disabled={downloadingTemplate}
              className="w-full flex items-center justify-center gap-2 text-xs font-medium text-ink-muted hover:text-ink py-2 rounded-lg border border-dashed border-border transition-colors"
            >
              {downloadingTemplate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Descargar plantilla
            </button>

            <label
              className="flex flex-col items-center justify-center gap-2 py-8 rounded-xl cursor-pointer transition-colors hover:bg-surface-muted"
              style={{ border: '2px dashed var(--border)' }}
            >
              <FileSpreadsheet className="w-6 h-6 text-ink-subtle" />
              <span className="text-xs text-ink-muted text-center px-4">
                {file ? file.name : 'Elige un archivo .xlsx o .csv'}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.csv"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>

            <div className="flex gap-2">
              <button onClick={handleClose} className="btn-secondary flex-1">Cancelar</button>
              <button onClick={handleUpload} disabled={!file || uploading} className="btn-primary flex-1">
                {uploading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Importar
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl p-3 text-center" style={{ background: '#E8FBF0' }}>
                <p className="text-xl font-bold" style={{ color: '#128C7E' }}>{result.created}</p>
                <p className="text-[10px] text-ink-muted mt-0.5">Creados</p>
              </div>
              <div className="rounded-xl p-3 text-center" style={{ background: 'var(--surface-muted)' }}>
                <p className="text-xl font-bold text-ink">{result.skippedDuplicate}</p>
                <p className="text-[10px] text-ink-muted mt-0.5">Ya existían</p>
              </div>
              <div className="rounded-xl p-3 text-center" style={{ background: 'var(--surface-muted)' }}>
                <p className="text-xl font-bold text-ink">{result.skippedInvalid}</p>
                <p className="text-[10px] text-ink-muted mt-0.5">Inválidos</p>
              </div>
            </div>

            {result.created > 0 && result.errors.length === 0 && (
              <div className="flex items-center gap-2 text-xs text-ink-muted">
                <CheckCircle2 className="w-3.5 h-3.5" style={{ color: '#25D366' }} />
                Todo se importó sin problemas.
              </div>
            )}

            {result.errors.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted mb-2">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Filas con problemas
                </div>
                <div className="max-h-40 overflow-y-auto rounded-lg divide-y divide-border" style={{ border: '1px solid var(--border)' }}>
                  {result.errors.map((e, i) => (
                    <div key={i} className="px-3 py-2 text-xs">
                      <span className="font-medium text-ink">Fila {e.row}:</span>{' '}
                      <span className="text-ink-muted">{e.reason}</span>
                    </div>
                  ))}
                </div>
                {result.truncatedErrors && (
                  <p className="text-[11px] text-ink-subtle mt-1.5">Mostrando los primeros {result.errors.length} problemas.</p>
                )}
              </div>
            )}

            <button onClick={handleClose} className="btn-primary w-full">Listo</button>
          </div>
        )}
      </div>
    </div>
  );
}
