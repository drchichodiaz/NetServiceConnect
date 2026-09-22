'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { contactTagsApi } from '@/lib/api';
import { ContactTag } from '@/types';
import { Tag as TagIcon, X, Plus, Check, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';

/**
 * Elegir etiquetas escribiendo. Si lo que se escribió no existe, la primera opción de
 * la lista es crearlo: nadie tiene que pasar antes por una pantalla de administración,
 * que es lo que hace que las etiquetas se carguen o no se carguen nunca.
 *
 * Es controlado (`value`/`onChange` con ids) y sirve igual para etiquetar un contacto
 * y para filtrar una lista; lo único que cambia es `allowCreate`.
 */

/** Caché a nivel de módulo: el picker aparece en tres pantallas y la lista es la misma. */
let cachedTags: ContactTag[] | null = null;
const subscribers = new Set<(tags: ContactTag[]) => void>();

function publish(tags: ContactTag[]) {
  cachedTags = tags;
  subscribers.forEach((fn) => fn(tags));
}

/** Refresca la lista compartida. La llama quien crea, renombra o borra etiquetas. */
export async function reloadContactTags() {
  const tags = await contactTagsApi.list();
  publish(tags);
  return tags;
}

export function useContactTags() {
  const [tags, setTags] = useState<ContactTag[]>(cachedTags ?? []);

  useEffect(() => {
    subscribers.add(setTags);
    if (cachedTags === null) reloadContactTags().catch(() => publish([]));
    else setTags(cachedTags);
    return () => { subscribers.delete(setTags); };
  }, []);

  return tags;
}

/** La pastilla de color, que es como se reconoce una etiqueta de un vistazo. */
export function TagChip({
  tag,
  onRemove,
  size = 'md',
}: {
  tag: ContactTag;
  onRemove?: () => void;
  size?: 'sm' | 'md';
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap',
        size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5',
      )}
      // El color va con transparencia sobre el fondo para que cualquier hex elegido
      // siga siendo legible, sin tener que calcular contraste.
      style={{ background: `${tag.color}1f`, color: tag.color }}
    >
      {tag.name}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="opacity-60 hover:opacity-100"
          aria-label={`Quitar ${tag.name}`}
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}
    </span>
  );
}

interface Props {
  value: string[];
  onChange: (tagIds: string[]) => void;
  /** false en los filtros: ahí es elegir entre las que hay, no inventar nuevas. */
  allowCreate?: boolean;
  placeholder?: string;
  /** Texto del botón cuando no hay ninguna elegida. */
  emptyLabel?: string;
  disabled?: boolean;
}

export default function TagPicker({
  value,
  onChange,
  allowCreate = true,
  placeholder = 'Buscar o crear etiqueta…',
  emptyLabel = 'Agregar etiqueta',
  disabled,
}: Props) {
  const tags = useContactTags();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => value.map((id) => tags.find((t) => t.id === id)).filter(Boolean) as ContactTag[],
    [value, tags],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tags.filter((t) => !q || t.name.toLowerCase().includes(q));
  }, [tags, query]);

  // Solo se ofrece crear si lo escrito no es ya una etiqueta: comparar en minúsculas
  // evita ofrecer "crear VIP" cuando ya existe "vip" y el backend devolvería esa misma.
  const exact = tags.some((t) => t.name.trim().toLowerCase() === query.trim().toLowerCase());
  const canCreate = allowCreate && query.trim().length > 0 && !exact;

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  async function createFromQuery() {
    const name = query.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const tag = await contactTagsApi.create(name);
      await reloadContactTags();
      // El backend devuelve la existente si ya estaba; sumarla de nuevo la repetiría.
      if (!value.includes(tag.id)) onChange([...value, tag.id]);
      setQuery('');
    } catch {
      toast.error('No se pudo crear la etiqueta');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="relative" ref={boxRef}>
      <div className="flex flex-wrap items-center gap-1.5">
        {selected.map((tag) => (
          <TagChip key={tag.id} tag={tag} onRemove={disabled ? undefined : () => toggle(tag.id)} />
        ))}
        {!disabled && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink border border-dashed rounded-full px-2 py-0.5"
            style={{ borderColor: 'var(--border)' }}
          >
            <Plus className="w-3 h-3" />
            {selected.length === 0 ? emptyLabel : 'Más'}
          </button>
        )}
      </div>

      {open && (
        <div
          className="absolute z-30 mt-1.5 w-64 rounded-xl shadow-lg overflow-hidden"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div className="p-2" style={{ borderBottom: '1px solid var(--border)' }}>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); if (canCreate) createFromQuery(); }
                if (e.key === 'Escape') setOpen(false);
              }}
              placeholder={placeholder}
              className="input w-full text-xs py-1.5"
            />
          </div>

          <div className="max-h-56 overflow-y-auto py-1">
            {canCreate && (
              <button
                type="button"
                onClick={createFromQuery}
                disabled={creating}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-surface-muted"
              >
                {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Crear <span className="font-semibold">«{query.trim()}»</span>
              </button>
            )}

            {matches.map((tag) => {
              const isOn = value.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggle(tag.id)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-muted"
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: tag.color }} />
                  <span className="flex-1 text-xs text-ink truncate">{tag.name}</span>
                  {typeof tag.contactCount === 'number' && (
                    <span className="text-[10px] text-ink-subtle">{tag.contactCount}</span>
                  )}
                  {isOn && <Check className="w-3.5 h-3.5 text-green-600 shrink-0" />}
                </button>
              );
            })}

            {matches.length === 0 && !canCreate && (
              <p className="px-3 py-3 text-[11px] text-ink-subtle flex items-center gap-1.5">
                <TagIcon className="w-3.5 h-3.5" />
                {tags.length === 0 ? 'Todavía no hay etiquetas' : 'Ninguna coincide'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
