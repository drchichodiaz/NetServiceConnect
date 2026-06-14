'use client';
import { useEffect, useState } from 'react';
import { tagsApi } from '@/lib/api';
import { Tag } from '@/types';
import { Plus, Loader2, Tag as TagIcon, X } from 'lucide-react';
import toast from 'react-hot-toast';

const PRESET_COLORS = ['#25D366', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316'];

export default function TagsPage() {
  const [tags,      setTags]      = useState<(Tag & { _count?: { conversations: number } })[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm,  setShowForm]  = useState(false);
  const [name,      setName]      = useState('');
  const [color,     setColor]     = useState(PRESET_COLORS[0]);
  const [isSaving,  setIsSaving]  = useState(false);

  useEffect(() => {
    tagsApi.list().then(setTags).finally(() => setIsLoading(false));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      const tag = await tagsApi.create({ name: name.trim(), color });
      setTags((prev) => [...prev, tag]);
      setName('');
      setShowForm(false);
      toast.success('Etiqueta creada');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al crear etiqueta');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto py-10 px-6 animate-fade-in">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-xl font-bold text-ink mb-1" style={{ letterSpacing: '-0.02em' }}>Etiquetas</h1>
          <p className="text-sm text-ink-muted">Clasifica conversaciones con etiquetas de colores</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? 'Cancelar' : 'Nueva'}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleCreate} className="card p-5 mb-5 animate-fade-in">
          <p className="text-sm font-semibold text-ink mb-4">Nueva etiqueta</p>
          <input
            required
            placeholder="Nombre de la etiqueta"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input mb-4"
          />

          {/* Color picker */}
          <div className="mb-4">
            <p className="text-xs text-ink-muted mb-2">Color</p>
            <div className="flex gap-2 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="w-7 h-7 rounded-full transition-all duration-150 focus:outline-none"
                  style={{
                    background: c,
                    boxShadow: color === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : 'none',
                    transform:  color === c ? 'scale(1.15)' : 'scale(1)',
                  }}
                />
              ))}
            </div>
          </div>

          {/* Preview */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs text-ink-muted">Vista previa:</span>
            <span
              className="text-xs font-medium rounded-full px-2.5 py-1"
              style={{ background: color + '20', color }}
            >
              {name || 'Etiqueta'}
            </span>
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary flex-1">Cancelar</button>
            <button type="submit" disabled={isSaving || !name.trim()} className="btn-primary flex-1">
              {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Crear etiqueta
            </button>
          </div>
        </form>
      )}

      {/* Tags list */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-5 h-5 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />
          </div>
        ) : tags.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <TagIcon className="w-7 h-7 text-ink-ghost" />
            <p className="text-sm text-ink-subtle">Sin etiquetas todavia</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {tags.map((tag, i) => (
              <div
                key={tag.id}
                className="flex items-center gap-3.5 px-5 py-3.5 animate-fade-in"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: tag.color }} />
                <span
                  className="text-xs font-semibold rounded-full px-2.5 py-1"
                  style={{ background: tag.color + '18', color: tag.color }}
                >
                  {tag.name}
                </span>
                <span className="flex-1" />
                {tag._count !== undefined && (
                  <span className="text-xs text-ink-subtle">
                    {tag._count.conversations} {tag._count.conversations === 1 ? 'conversacion' : 'conversaciones'}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
