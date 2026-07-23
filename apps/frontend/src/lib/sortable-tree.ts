export type MenuNodeType = 'MENU' | 'TEXT' | 'ORDER_LOOKUP' | 'AGENT' | 'AI_CHAT';

export interface MenuNode {
  id: string;
  tenantId: string;
  parentId: string | null;
  type: MenuNodeType;
  title: string;
  subtitle: string | null;
  bodyText: string | null;
  promptText: string | null;
  active: boolean;
  sortOrder: number;
}

export interface FlattenedNode extends MenuNode {
  depth: number;
}

const INDENTATION_WIDTH = 24;

/** Aplana el árbol a un array ordenado depth-first — colapsa los hijos de nodos en `collapsed`. */
export function flattenTree(nodes: MenuNode[], collapsed: Set<string>): FlattenedNode[] {
  const byParent = new Map<string | null, MenuNode[]>();
  for (const node of nodes) {
    const key = node.parentId;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(node);
  }
  for (const list of Array.from(byParent.values())) list.sort((a, b) => a.sortOrder - b.sortOrder);

  const result: FlattenedNode[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const node of byParent.get(parentId) ?? []) {
      result.push({ ...node, depth });
      if (!collapsed.has(node.id)) walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return result;
}

export function countDescendants(nodes: MenuNode[], id: string): number {
  const children = nodes.filter((n) => n.parentId === id);
  return children.reduce((sum, child) => sum + 1 + countDescendants(nodes, child.id), 0);
}

interface ProjectionInput {
  items: FlattenedNode[];
  activeId: string;
  overId: string;
  dragOffsetX: number;
}

export interface Projection {
  depth: number;
  parentId: string | null;
}

/**
 * Durante un drag, calcula a qué profundidad/padre "cae" el nodo activo según su
 * posición vertical (overId, ya reordenado) y el offset horizontal del puntero.
 * Solo un nodo de tipo MENU puede ser padre — por eso el tope de profundidad se
 * calcula contra el item anterior únicamente cuando ese item es MENU.
 */
export function getProjection({ items, activeId, overId, dragOffsetX }: ProjectionInput): Projection {
  const activeIndex = items.findIndex((i) => i.id === activeId);
  const overIndex = items.findIndex((i) => i.id === overId);
  const reordered = arrayMove(items, activeIndex, overIndex);

  const previousItem = reordered[overIndex - 1];
  const nextItem = reordered[overIndex + 1];

  const dragDepth = Math.round(dragOffsetX / INDENTATION_WIDTH);
  const projectedDepth = items[activeIndex].depth + dragDepth;

  const maxDepth = previousItem ? (previousItem.type === 'MENU' ? previousItem.depth + 1 : previousItem.depth) : 0;
  const minDepth = nextItem ? nextItem.depth : 0;

  let depth = projectedDepth;
  if (projectedDepth > maxDepth) depth = maxDepth;
  else if (projectedDepth < minDepth) depth = minDepth;

  return { depth, parentId: getParentId(reordered, overIndex, depth, previousItem) };
}

function getParentId(
  reordered: FlattenedNode[],
  overIndex: number,
  depth: number,
  previousItem: FlattenedNode | undefined,
): string | null {
  if (depth === 0 || !previousItem) return null;
  if (depth === previousItem.depth) return previousItem.parentId;
  if (depth > previousItem.depth) return previousItem.id;

  const ancestor = reordered
    .slice(0, overIndex)
    .reverse()
    .find((item) => item.depth === depth);
  return ancestor?.parentId ?? null;
}

export function arrayMove<T>(array: T[], from: number, to: number): T[] {
  const copy = array.slice();
  const [moved] = copy.splice(from, 1);
  copy.splice(to, 0, moved);
  return copy;
}

export { INDENTATION_WIDTH };
