'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { contactsApi, conversationsApi, templatesApi, whatsappApi, ImportContactsResult } from '@/lib/api';
import TagPicker, { TagChip, reloadContactTags, useContactTags } from '@/components/contacts/TagPicker';
import TagManager from '@/components/contacts/TagManager';
import type { MessageTemplate } from '@/lib/api';
import { TemplatePreview } from '@/app/settings/templates/components/TemplatePreview';
import { useAuthedMedia } from '@/hooks/useAuthedMedia';
import { useInboxStore } from '@/store/inbox.store';
import { Contact, Conversation } from '@/types';
import {
  Search, Phone, Mail, Building2, MessageSquare,
  Pencil, Check, X, ChevronRight, Users, MessageCirclePlus, Loader2,
  Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle2,
  Tag as TagIcon, Settings2,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import clsx from 'clsx';

// El tipo vive en lib/api: la plantilla tiene encabezado, pie y botones, y una copia
// local de la forma se desactualizaba cada vez que se agregaba un componente.
type Template = MessageTemplate;

function countVars(text: string) {
  return new Set(text.match(/\{\{\d+\}\}/g) ?? []).size;
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

  // Etiquetas: filtro de la lista, selección múltiple para etiquetar en lote, y la
  // ventana de administración (renombrar / color / borrar).
  const allTags = useContactTags();
  const [filterTagIds, setFilterTagIds] = useState<string[]>([]);
  const [tagMatch, setTagMatch] = useState<'ANY' | 'ALL'>('ANY');
  const [picked, setPicked] = useState<string[]>([]);
  const [showTagManager, setShowTagManager] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async (q?: string, tagIds: string[] = [], match: 'ANY' | 'ALL' = 'ANY') => {
    setLoading(true);
    try { setContacts(await contactsApi.list(q, { tagIds, tagMatch: match })); }
    catch { toast.error('Error al cargar contactos'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Debounce search. El filtro por etiquetas entra por el mismo camino: cambiarlo
  // recarga la lista igual que escribir en el buscador.
  useEffect(() => {
    const t = setTimeout(() => load(search || undefined, filterTagIds, tagMatch), 300);
    return () => clearTimeout(t);
  }, [search, filterTagIds, tagMatch, load]);

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

  /** Las etiquetas de la ficha abierta. Guarda en el momento, sin botón de confirmar. */
  async function saveTags(tagIds: string[]) {
    if (!selected) return;
    const previous = selected.tags ?? [];
    // Optimista: la pastilla aparece apenas se elige. Si el guardado falla se vuelve
    // atrás, que es mejor que una espera de medio segundo en cada clic.
    const optimistic = tagIds
      .map((id) => allTags.find((t) => t.id === id))
      .filter(Boolean) as typeof previous;
    setSelected({ ...selected, tags: optimistic });
    setContacts((prev) => prev.map((c) => (c.id === selected.id ? { ...c, tags: optimistic } : c)));
    try {
      const updated = await contactsApi.setTags(selected.id, tagIds);
      setSelected((cur) => (cur && cur.id === updated.id ? { ...cur, tags: updated.tags } : cur));
      setContacts((prev) => prev.map((c) => (c.id === updated.id ? { ...c, tags: updated.tags } : c)));
      // Los contadores de cada etiqueta cambiaron.
      reloadContactTags().catch(() => {});
    } catch {
      toast.error('No se pudieron guardar las etiquetas');
      setSelected((cur) => (cur && cur.id === selected.id ? { ...cur, tags: previous } : cur));
      setContacts((prev) => prev.map((c) => (c.id === selected.id ? { ...c, tags: previous } : c)));
    }
  }

  /** Suma una etiqueta a todos los contactos tildados. */
  async function bulkAddTag(tagId: string) {
    if (picked.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await contactsApi.bulkTag({ contactIds: picked, addTagIds: [tagId] });
      const name = allTags.find((t) => t.id === tagId)?.name ?? 'la etiqueta';
      toast.success(
        res.added === 0
          ? `Todos los seleccionados ya tenían «${name}»`
          : `«${name}» agregada a ${res.added} contacto${res.added === 1 ? '' : 's'}`,
      );
      setPicked([]);
      await Promise.all([load(search || undefined, filterTagIds, tagMatch), reloadContactTags()]);
    } catch {
      toast.error('No se pudo etiquetar');
    } finally {
      setBulkBusy(false);
    }
  }

  function togglePicked(id: string) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  async function handleConversationStarted(conversationId: string) {
    setShowNewConv(false);
    setNewConvContact(null);
    await useInboxStore.getState().loadConversations();
    useInboxStore.getState().selectConversation(conversationId);
    router.push('/inbox');
  }

  const displayName = selected ? (selected.name || selected.phone || 'Contacto sin nombre') : '';

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
                onClick={() => setShowTagManager(true)}
                title="Administrar etiquetas"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-subtle hover:text-ink hover:bg-black/5"
              >
                <TagIcon className="w-4 h-4" />
              </button>
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

          {/* Filtro por etiquetas. Solo aparece si hay alguna: sin etiquetas cargadas
              sería una fila vacía que no hace nada. */}
          {allTags.length > 0 && (
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <TagPicker
                value={filterTagIds}
                onChange={setFilterTagIds}
                allowCreate={false}
                emptyLabel="Filtrar por etiqueta"
                placeholder="Buscar etiqueta…"
              />
              {/* Con una sola etiqueta elegida los dos modos dan lo mismo. */}
              {filterTagIds.length > 1 && (
                <button
                  onClick={() => setTagMatch((m) => (m === 'ANY' ? 'ALL' : 'ANY'))}
                  className="text-[10px] text-ink-muted hover:text-ink underline decoration-dotted"
                  title="Cambiar entre tener alguna o tenerlas todas"
                >
                  {tagMatch === 'ANY' ? 'con alguna' : 'con todas'}
                </button>
              )}
              {filterTagIds.length > 0 && (
                <button
                  onClick={() => setFilterTagIds([])}
                  className="text-[10px] text-ink-subtle hover:text-ink"
                >
                  Limpiar
                </button>
              )}
            </div>
          )}

          {/* Barra de acciones en lote: solo existe mientras haya algo tildado. */}
          {picked.length > 0 && (
            <div
              className="mt-2 flex items-center gap-2 rounded-lg px-2.5 py-2"
              style={{ background: 'var(--surface-muted)' }}
            >
              <span className="text-[11px] font-medium text-ink">
                {picked.length} seleccionado{picked.length === 1 ? '' : 's'}
              </span>
              {bulkBusy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-ink-muted" />
              ) : (
                <TagPicker
                  value={[]}
                  onChange={(ids) => { const added = ids[ids.length - 1]; if (added) bulkAddTag(added); }}
                  emptyLabel="Etiquetar"
                  placeholder="Buscar o crear etiqueta…"
                />
              )}
              <button
                onClick={() => setPicked([])}
                className="text-[10px] text-ink-subtle hover:text-ink ml-auto"
              >
                Cancelar
              </button>
            </div>
          )}
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
              const name = c.name || c.phone || 'Contacto sin nombre';
              const isSelected = selected?.id === c.id;
              const isPicked = picked.includes(c.id);
              return (
                // Fila y no <button>: adentro va el tilde de selección múltiple, y un
                // botón dentro de otro botón no es HTML válido.
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => selectContact(c)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectContact(c); } }}
                  className={clsx(
                    'group w-full flex items-center gap-3 px-4 py-3 text-left transition-all cursor-pointer',
                    isSelected ? 'bg-green-50' : 'hover:bg-surface-muted',
                  )}
                  style={{ borderBottom: '1px solid var(--border)' }}
                >
                  {isSelected && (
                    <span className="absolute left-0 w-[3px] h-10 rounded-r-full" style={{ background: '#25D366' }} />
                  )}
                  {/* El tilde aparece al pasar el mouse, o queda fijo si ya hay algo
                      seleccionado: mientras no se etiquete en lote no estorba. */}
                  <input
                    type="checkbox"
                    checked={isPicked}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => togglePicked(c.id)}
                    aria-label={`Seleccionar ${name}`}
                    className={clsx(
                      'w-3.5 h-3.5 shrink-0 accent-green-600 cursor-pointer',
                      isPicked || picked.length > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                    )}
                  />
                  <Avatar name={name} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink truncate">{name}</p>
                    <p className="text-xs text-ink-muted truncate">
                      {c.company ? `${c.company} · ` : ''}{c.phone}
                    </p>
                    {(c.tags?.length ?? 0) > 0 && (
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        {c.tags!.slice(0, 3).map((t) => (
                          <TagChip key={t.id} tag={t} size="sm" />
                        ))}
                        {c.tags!.length > 3 && (
                          <span className="text-[10px] text-ink-subtle">+{c.tags!.length - 3}</span>
                        )}
                      </div>
                    )}
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
                </div>
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

              {/* Etiquetas. Fuera del modo edición a propósito: se ponen y se sacan en
                  el momento, sin entrar a editar ni guardar el formulario. */}
              <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
                <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <TagIcon className="w-3 h-3" />
                  Etiquetas
                </p>
                <TagPicker
                  value={(selected.tags ?? []).map((t) => t.id)}
                  onChange={saveTags}
                />
              </div>
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
          onImported={() => {
            // El archivo pudo haber creado etiquetas nuevas, así que se recargan las dos cosas.
            load(search || undefined, filterTagIds, tagMatch);
            reloadContactTags().catch(() => {});
          }}
        />
      )}

      {showTagManager && <TagManager onClose={() => setShowTagManager(false)} />}
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
  // Una plantilla completa puede pedir valores en tres lugares distintos: el encabezado
  // de texto, el cuerpo y la URL de cada boton de enlace dinamico.
  const [headerVariables, setHeaderVariables] = useState<string[]>([]);
  const [buttonVariables, setButtonVariables] = useState<{ index: number; value: string }[]>([]);
  const [sending, setSending] = useState(false);

  // Línea desde la que sale el mensaje. Importa por dos motivos: el cliente recibe el
  // mensaje desde ese número, y las plantillas disponibles son las del WABA de esa línea.
  const [accounts, setAccounts] = useState<any[]>([]);
  const [accountId, setAccountId] = useState('');
  const [hasOtherWabaTemplates, setHasOtherWabaTemplates] = useState(false);

  useEffect(() => {
    whatsappApi.listActiveAccounts()
      .then((accs) => {
        setAccounts(accs);
        // Arranca en la predeterminada — el comportamiento de antes de que existiera
        // el selector, así que un tenant de una sola línea no nota ningún cambio.
        setAccountId((accs.find((a: any) => a.isDefault) ?? accs[0])?.id ?? '');
      })
      .catch(() => setAccounts([]));
  }, []);

  // Las plantillas se recargan cada vez que cambia la línea: son las de su WABA.
  useEffect(() => {
    if (!accountId) return;
    setLoadingTemplates(true);
    setTemplateId('');
    setVariables([]);
    setHeaderVariables([]);
    setButtonVariables([]);
    Promise.all([templatesApi.list({ channelAccountId: accountId }), templatesApi.list()])
      .then(([forLine, all]: [Template[], Template[]]) => {
        const usable = forLine.filter((t) => t.status === 'APPROVED');
        setTemplates(usable);
        // Para poder explicar una lista vacía en vez de mostrarla pelada.
        setHasOtherWabaTemplates(usable.length === 0 && all.some((t) => t.status === 'APPROVED'));
      })
      .catch(() => toast.error('Error al cargar plantillas'))
      .finally(() => setLoadingTemplates(false));
  }, [accountId]);

  const selectedTemplate = templates.find((t) => t.id === templateId) || null;
  // La imagen del encabezado va detras del JWT, asi que no sirve como <img src> directo.
  const { url: headerImageUrl } = useAuthedMedia(
    selectedTemplate?.headerFormat === 'IMAGE' ? templatesApi.headerMediaPath(selectedTemplate.id) : null,
  );

  function handleSelectTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((tpl) => tpl.id === id);
    setVariables(t ? Array(t.variableCount).fill('') : []);
    setHeaderVariables(t?.headerFormat === 'TEXT' && countVars(t.headerText ?? '') > 0 ? [''] : []);
    setButtonVariables(
      (t?.buttons ?? [])
        .map((b, index) => ({ button: b, index }))
        .filter(({ button }) => button.type === 'URL' && (button.url ?? '').includes('{{1}}'))
        .map(({ index }) => ({ index, value: '' })),
    );
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
        headerVariables: headerVariables.length > 0 ? headerVariables : undefined,
        buttonVariables: buttonVariables.length > 0 ? buttonVariables : undefined,
        channelAccountId: accountId || undefined,
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
            {contact ? `Nueva conversación con ${contact.name || contact.phone || 'el contacto'}` : 'Nueva conversación'}
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

          {/* Selector de línea — oculto si hay una sola, no hay nada que elegir */}
          {accounts.length > 1 && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-ink">Enviar desde</label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="input w-full"
              >
                {accounts.map((a: any) => (
                  <option key={a.id} value={a.id}>
                    {(a.label?.trim() || a.phoneNumber || 'Línea sin nombre') + (a.isDefault ? ' (predeterminada)' : '')}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-ink-subtle">
                El cliente va a recibir el mensaje desde este número.
              </p>
            </div>
          )}

          {loadingTemplates ? (
            <div className="flex items-center gap-2 text-sm text-ink-muted py-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Cargando plantillas...
            </div>
          ) : templates.length === 0 ? (
            hasOtherWabaTemplates ? (
              <p className="text-sm text-ink-muted py-2">
                Esta línea no tiene plantillas aprobadas. Las que tenés pertenecen a otra cuenta
                de WhatsApp Business y Meta no permite enviarlas desde acá. Elegí otra línea, o
                creá la plantilla para esta cuenta en Configuración → Plantillas.
              </p>
            ) : (
              <p className="text-sm text-ink-muted py-2">
                No tienes plantillas aprobadas todavía. Crea una en Settings → Plantillas y espera su aprobación de Meta.
              </p>
            )
          ) : (
            <select value={templateId} onChange={(e) => handleSelectTemplate(e.target.value)} className="input w-full">
              <option value="">Elige una plantilla...</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}

          {selectedTemplate && (
            <TemplatePreview
              headerFormat={selectedTemplate.headerFormat}
              headerText={selectedTemplate.headerText}
              headerImageUrl={headerImageUrl}
              bodyText={selectedTemplate.bodyText}
              footerText={selectedTemplate.footerText}
              buttons={selectedTemplate.buttons}
              exampleValues={variables}
              headerExampleValues={headerVariables}
            />
          )}

          {/* Los valores van agrupados por componente: con encabezado y botones en juego,
              una lista plana de "Variable {{1}}" no deja saber cual es cual. */}
          {headerVariables.length > 0 && (
            <div>
              <label className="text-xs font-semibold text-ink block mb-1.5">Encabezado</label>
              <input
                placeholder="Valor de {{1}} del encabezado"
                value={headerVariables[0] ?? ''}
                onChange={(e) => setHeaderVariables([e.target.value])}
                className="input w-full"
              />
            </div>
          )}

          {variables.length > 0 && (
            <div>
              <label className="text-xs font-semibold text-ink block mb-1.5">Cuerpo</label>
              <div className="space-y-2">
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
            </div>
          )}

          {buttonVariables.length > 0 && (
            <div>
              <label className="text-xs font-semibold text-ink block mb-1.5">Enlaces de los botones</label>
              <div className="space-y-2">
                {buttonVariables.map((bv) => (
                  <input
                    key={bv.index}
                    placeholder={`Valor del enlace de "${selectedTemplate?.buttons?.[bv.index]?.text ?? 'botón'}"`}
                    value={bv.value}
                    onChange={(e) =>
                      setButtonVariables((prev) =>
                        prev.map((item) => (item.index === bv.index ? { ...item, value: e.target.value } : item)),
                      )
                    }
                    className="input w-full"
                  />
                ))}
              </div>
            </div>
          )}
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

            {/* Las etiquetas se aplican también a los que ya existían, así que esto
                puede ser mayor que "Creados" — y es justamente para lo que sirve volver
                a subir una lista: etiquetar gente que ya estaba cargada. */}
            {result.tagged > 0 && (
              <div className="flex items-center gap-2 text-xs text-ink-muted">
                <TagIcon className="w-3.5 h-3.5" style={{ color: '#6366f1' }} />
                {result.tagged} contacto{result.tagged === 1 ? '' : 's'} quedaron etiquetados desde la columna «Etiquetas».
              </div>
            )}

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
