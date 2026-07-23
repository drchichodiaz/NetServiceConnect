'use client';
import { CSS } from '@dnd-kit/utilities';
import { useSortable } from '@dnd-kit/sortable';
import { GripVertical, ChevronRight, ChevronDown, FolderTree, MessageSquare, PackageSearch, Headphones, Sparkles } from 'lucide-react';
import clsx from 'clsx';
import { FlattenedNode, INDENTATION_WIDTH, MenuNodeType } from '@/lib/sortable-tree';

export const TYPE_ICON: Record<MenuNodeType, typeof FolderTree> = {
  MENU: FolderTree,
  TEXT: MessageSquare,
  ORDER_LOOKUP: PackageSearch,
  AGENT: Headphones,
  AI_CHAT: Sparkles,
};

export const TYPE_LABEL: Record<MenuNodeType, string> = {
  MENU: 'Submenú',
  TEXT: 'Texto',
  ORDER_LOOKUP: 'Consultar pedido',
  AGENT: 'Hablar con un agente',
  AI_CHAT: 'Modo IA',
};

// El modo IA usa la paleta morada que ya identifica todo lo de IA en la app
// (/settings/ai) — el resto de los tipos comparte el verde de WhatsApp.
const TYPE_COLOR: Record<MenuNodeType, { bg: string; fg: string }> = {
  MENU: { bg: 'var(--green-light)', fg: 'var(--green-dark)' },
  TEXT: { bg: 'var(--green-light)', fg: 'var(--green-dark)' },
  ORDER_LOOKUP: { bg: 'var(--green-light)', fg: 'var(--green-dark)' },
  AGENT: { bg: 'var(--green-light)', fg: 'var(--green-dark)' },
  AI_CHAT: { bg: '#F3E8FF', fg: '#9333EA' },
};

export const ADDABLE_TYPES: { type: MenuNodeType; label: string }[] = [
  { type: 'TEXT', label: 'Texto' },
  { type: 'MENU', label: 'Submenú' },
  { type: 'ORDER_LOOKUP', label: 'Consultar pedido' },
  { type: 'AGENT', label: 'Hablar con un agente' },
  { type: 'AI_CHAT', label: 'Modo IA' },
];

interface Props {
  node: FlattenedNode;
  selected: boolean;
  collapsed: boolean;
  hasChildren: boolean;
  onSelect: () => void;
  onToggleCollapse: () => void;
}

export default function MenuNodeRow({ node, selected, collapsed, hasChildren, onSelect, onToggleCollapse }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.id });
  const Icon = TYPE_ICON[node.type];

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    paddingLeft: node.depth * INDENTATION_WIDTH + 8,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(
        'flex items-center gap-1.5 py-2 pr-3 rounded-lg border transition-colors',
        selected ? 'border-green-500' : 'border-transparent hover:bg-surface-muted',
        isDragging && 'opacity-40',
      )}
      data-menu-node-id={node.id}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="btn-ghost w-6 h-6 p-0 cursor-grab active:cursor-grabbing shrink-0 touch-none"
        aria-label="Arrastrar para mover"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>

      {node.type === 'MENU' && hasChildren ? (
        <button type="button" onClick={onToggleCollapse} className="btn-ghost w-5 h-5 p-0 shrink-0">
          {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      ) : (
        <span className="w-5 h-5 shrink-0" />
      )}

      <button type="button" onClick={onSelect} className="flex items-center gap-2 flex-1 min-w-0 text-left">
        <span className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0" style={{ background: TYPE_COLOR[node.type].bg }}>
          <Icon className="w-3.5 h-3.5" style={{ color: TYPE_COLOR[node.type].fg }} />
        </span>
        <span className="min-w-0">
          <span className={clsx('block text-sm font-medium truncate', node.active ? 'text-ink' : 'text-ink-subtle line-through')}>
            {node.title || '(sin título)'}
          </span>
          <span className="block text-[10px] text-ink-subtle">{TYPE_LABEL[node.type]}</span>
        </span>
      </button>

      {!node.active && (
        <span
          className="text-[10px] font-semibold rounded-full px-2 py-0.5 shrink-0"
          style={{ background: 'var(--surface-muted)', color: 'var(--ink-subtle)' }}
        >
          Inactiva
        </span>
      )}
    </div>
  );
}
