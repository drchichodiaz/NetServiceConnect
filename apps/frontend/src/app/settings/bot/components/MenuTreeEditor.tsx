'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragMoveEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus, FolderTree } from 'lucide-react';
import toast from 'react-hot-toast';
import { menuNodesApi } from '@/lib/api';
import { MenuNode, MenuNodeType, flattenTree, getProjection, countDescendants, arrayMove, INDENTATION_WIDTH, Projection } from '@/lib/sortable-tree';
import MenuNodeRow, { TYPE_LABEL, TYPE_ICON, ADDABLE_TYPES } from './MenuNodeRow';
import NodeEditPanel from './NodeEditPanel';

const DEFAULT_TITLE: Record<MenuNodeType, string> = {
  TEXT: 'Nueva opción',
  MENU: 'Nuevo submenú',
  ORDER_LOOKUP: 'Consultar mi orden',
  AGENT: 'Hablar con un agente',
  AI_CHAT: 'Pregúntame lo que quieras',
};

export default function MenuTreeEditor() {
  const [nodes, setNodes] = useState<MenuNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [projection, setProjection] = useState<Projection | null>(null);
  const [showRootAdd, setShowRootAdd] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const tree = await menuNodesApi.getTree();
      setNodes(tree);
    } catch {
      toast.error('Error al cargar el menú del bot');
    } finally {
      setLoading(false);
    }
  }

  const effectiveCollapsed = useMemo(() => {
    if (!activeId) return collapsed;
    const s = new Set(collapsed);
    s.add(activeId);
    return s;
  }, [collapsed, activeId]);

  const flattened = useMemo(() => flattenTree(nodes, effectiveCollapsed), [nodes, effectiveCollapsed]);
  const childCountByParent = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of nodes) {
      if (n.parentId) map.set(n.parentId, (map.get(n.parentId) ?? 0) + 1);
    }
    return map;
  }, [nodes]);

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;
  const activeNode = flattened.find((n) => n.id === activeId) ?? null;

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragMove(event: DragMoveEvent) {
    const { active, over, delta } = event;
    if (!over) {
      setProjection(null);
      return;
    }
    setProjection(getProjection({ items: flattened, activeId: String(active.id), overId: String(over.id), dragOffsetX: delta.x }));
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const finalProjection = projection;
    setActiveId(null);
    setProjection(null);
    if (!over || !finalProjection) return;

    const activeNodeId = String(active.id);
    const overId = String(over.id);
    const activeIndex = flattened.findIndex((i) => i.id === activeNodeId);
    const overIndex = flattened.findIndex((i) => i.id === overId);
    if (activeIndex === -1 || overIndex === -1) return;
    if (activeIndex === overIndex && flattened[activeIndex].parentId === finalProjection.parentId) return;

    const reordered = arrayMove(flattened, activeIndex, overIndex).map((item) =>
      item.id === activeNodeId ? { ...item, parentId: finalProjection.parentId, depth: finalProjection.depth } : item,
    );
    const orderedSiblingIds = reordered.filter((n) => n.parentId === finalProjection.parentId).map((n) => n.id);

    const prevNodes = nodes;
    setNodes((current) => current.map((n) => (n.id === activeNodeId ? { ...n, parentId: finalProjection.parentId } : n)));

    try {
      const tree = await menuNodesApi.move(activeNodeId, { parentId: finalProjection.parentId, orderedSiblingIds });
      setNodes(tree);
    } catch (err: any) {
      setNodes(prevNodes);
      toast.error(err?.response?.data?.message || 'No se pudo mover la opción');
    }
  }

  async function handleCreate(parentId: string | null, type: MenuNodeType) {
    try {
      const created = await menuNodesApi.create({ parentId, type, title: DEFAULT_TITLE[type] });
      setNodes((prev) => [...prev, created]);
      if (parentId) {
        setCollapsed((prev) => {
          const next = new Set(prev);
          next.delete(parentId);
          return next;
        });
      }
      setSelectedId(created.id);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo crear la opción');
    }
  }

  async function handleUpdate(id: string, patch: Record<string, any>) {
    const prevNodes = nodes;
    setNodes((current) => current.map((n) => (n.id === id ? { ...n, ...patch } : n)));
    setSaving(true);
    try {
      const updated = await menuNodesApi.update(id, patch);
      setNodes((current) => current.map((n) => (n.id === id ? updated : n)));
    } catch (err: any) {
      setNodes(prevNodes);
      toast.error(err?.response?.data?.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await menuNodesApi.remove(id);
      const tree = await menuNodesApi.getTree();
      setNodes(tree);
      if (selectedId === id) setSelectedId(null);
      toast.success('Opción eliminada');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo eliminar');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start">
      <div className="flex-1 min-w-0 w-full space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-ink-muted">Arrastra una opción para reordenarla o moverla adentro de un submenú.</p>
          <div className="relative">
            <button onClick={() => setShowRootAdd((v) => !v)} className="btn-primary text-sm">
              <Plus className="w-4 h-4" />
              Nueva opción
            </button>
            {showRootAdd && (
              <div className="absolute right-0 mt-2 w-56 card p-2 z-10 space-y-1">
                {ADDABLE_TYPES.map((t) => {
                  const Icon = TYPE_ICON[t.type];
                  return (
                    <button
                      key={t.type}
                      onClick={() => { handleCreate(null, t.type); setShowRootAdd(false); }}
                      className="btn-ghost w-full justify-start text-sm gap-2"
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {nodes.length === 0 ? (
          <div className="card flex flex-col items-center justify-center py-14 text-center" style={{ border: '2px dashed var(--border)' }}>
            <FolderTree className="w-6 h-6 text-ink-subtle mb-2" />
            <p className="text-sm font-semibold text-ink">Todavía no armaste el menú</p>
            <p className="text-xs text-ink-muted mt-1 mb-4">Agrega la primera opción para que el bot empiece a responder.</p>
            <button onClick={() => handleCreate(null, 'TEXT')} className="btn-primary text-sm">
              <Plus className="w-4 h-4" />
              Agregar primera opción
            </button>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
            onDragCancel={() => { setActiveId(null); setProjection(null); }}
          >
            <div className="card p-2">
              <SortableContext items={flattened.map((n) => n.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-0.5">
                  {flattened.map((node) => (
                    <MenuNodeRow
                      key={node.id}
                      node={node}
                      selected={node.id === selectedId}
                      collapsed={collapsed.has(node.id)}
                      hasChildren={(childCountByParent.get(node.id) ?? 0) > 0}
                      onSelect={() => setSelectedId(node.id)}
                      onToggleCollapse={() => toggleCollapse(node.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </div>

            <DragOverlay>
              {activeNode && (
                <div
                  className="card px-3 py-2 shadow-card-md flex items-center gap-2 bg-white"
                  style={{ marginLeft: (projection?.depth ?? activeNode.depth) * INDENTATION_WIDTH, opacity: 0.95 }}
                >
                  <span className="text-sm font-medium text-ink">{activeNode.title}</span>
                  <span className="text-[10px] text-ink-subtle">{TYPE_LABEL[activeNode.type]}</span>
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      <div className="w-full lg:w-80 shrink-0">
        {selectedNode ? (
          <NodeEditPanel
            node={selectedNode}
            descendantCount={countDescendants(nodes, selectedNode.id)}
            saving={saving}
            onSave={(patch) => handleUpdate(selectedNode.id, patch)}
            onDelete={() => handleDelete(selectedNode.id)}
            onAddChild={(type) => handleCreate(selectedNode.id, type)}
            onClose={() => setSelectedId(null)}
          />
        ) : (
          <div className="card p-5 text-center">
            <p className="text-xs text-ink-muted">Elige una opción del menú para editarla.</p>
          </div>
        )}
      </div>
    </div>
  );
}
