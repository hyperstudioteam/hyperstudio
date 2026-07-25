import {
  ConnectionProfile,
  DropPosition,
  TreeNode,
} from "../types/connection";

export function findConnection(
  nodes: TreeNode[],
  id: string,
): ConnectionProfile | null {
  for (const node of nodes) {
    if (node.kind === "connection" && node.profile.id === id) {
      return node.profile;
    }
    if (node.kind === "folder") {
      const found = findConnection(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function findFolder(nodes: TreeNode[], id: string): Extract<TreeNode, { kind: "folder" }> | null {
  for (const node of nodes) {
    if (node.kind === "folder" && node.id === id) return node;
    if (node.kind === "folder") {
      const found = findFolder(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function firstConnectionId(nodes: TreeNode[]): string | null {
  for (const node of nodes) {
    if (node.kind === "connection") return node.profile.id;
    if (node.kind === "folder") {
      const nested = firstConnectionId(node.children);
      if (nested) return nested;
    }
  }
  return null;
}

export function insertIntoFolder(
  nodes: TreeNode[],
  folderId: string | null,
  item: TreeNode,
): TreeNode[] {
  if (folderId === null) return [...nodes, item];
  return nodes.map((node) => {
    if (node.kind === "folder" && node.id === folderId) {
      return { ...node, children: [...node.children, item] };
    }
    if (node.kind === "folder") {
      return {
        ...node,
        children: insertIntoFolder(node.children, folderId, item),
      };
    }
    return node;
  });
}

export function removeFromTree(
  nodes: TreeNode[],
  id: string,
): { nodes: TreeNode[]; removed: TreeNode | null } {
  let removed: TreeNode | null = null;
  const next: TreeNode[] = [];
  for (const node of nodes) {
    if (
      (node.kind === "connection" && node.profile.id === id) ||
      (node.kind === "folder" && node.id === id)
    ) {
      removed = node;
      continue;
    }
    if (node.kind === "folder") {
      const result = removeFromTree(node.children, id);
      if (result.removed) removed = result.removed;
      next.push({ ...node, children: result.nodes });
    } else {
      next.push(node);
    }
  }
  return { nodes: next, removed };
}

export function collectFolderOptions(
  nodes: TreeNode[],
  depth = 0,
  excludeId?: string,
): { id: string | null; label: string }[] {
  const options: { id: string | null; label: string }[] = [];
  if (depth === 0) options.push({ id: null, label: "Root" });
  for (const node of nodes) {
    if (node.kind !== "folder") continue;
    if (node.id === excludeId) continue;
    options.push({
      id: node.id,
      label: `${"— ".repeat(depth)}${node.name}`,
    });
    options.push(...collectFolderOptions(node.children, depth + 1, excludeId));
  }
  return options;
}

export function findParentFolderId(
  nodes: TreeNode[],
  id: string,
  parentId: string | null = null,
): string | null | undefined {
  for (const node of nodes) {
    if (
      (node.kind === "connection" && node.profile.id === id) ||
      (node.kind === "folder" && node.id === id)
    ) {
      return parentId;
    }
    if (node.kind === "folder") {
      const found = findParentFolderId(node.children, id, node.id);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

export function isDescendantFolder(
  nodes: TreeNode[],
  folderId: string,
  candidateId: string,
): boolean {
  const folder = findFolder(nodes, folderId);
  if (!folder) return false;
  const walk = (children: TreeNode[]): boolean => {
    for (const child of children) {
      if (child.kind === "folder") {
        if (child.id === candidateId) return true;
        if (walk(child.children)) return true;
      }
    }
    return false;
  };
  return walk(folder.children);
}

function nodeId(node: TreeNode) {
  return node.kind === "folder" ? node.id : node.profile.id;
}

/** Move a dragged node relative to a drop target. */
export function moveTreeNode(
  nodes: TreeNode[],
  dragId: string,
  targetId: string,
  position: DropPosition,
): TreeNode[] {
  if (dragId === targetId) return nodes;

  // Prevent nesting a folder into itself/descendants before mutating.
  if (
    position === "into" &&
    findFolder(nodes, dragId) &&
    (dragId === targetId || isDescendantFolder(nodes, dragId, targetId))
  ) {
    return nodes;
  }

  const { nodes: without, removed } = removeFromTree(nodes, dragId);
  if (!removed) return nodes;

  if (
    removed.kind === "folder" &&
    isDescendantFolder(nodes, dragId, targetId)
  ) {
    return nodes;
  }

  const insertRelative = (list: TreeNode[]): TreeNode[] | null => {
    const next: TreeNode[] = [];
    let handled = false;
    for (const node of list) {
      const id = nodeId(node);
      if (id === targetId) {
        if (position === "before") {
          next.push(removed, node);
          handled = true;
          continue;
        }
        if (position === "after") {
          next.push(node, removed);
          handled = true;
          continue;
        }
        if (position === "into") {
          if (node.kind === "folder") {
            next.push({ ...node, children: [...node.children, removed] });
            handled = true;
            continue;
          }
          // Dropping "into" a connection nests under the same parent, after it.
          next.push(node, removed);
          handled = true;
          continue;
        }
      }
      if (node.kind === "folder") {
        const nested = insertRelative(node.children);
        if (nested) {
          next.push({ ...node, children: nested });
          handled = true;
          continue;
        }
      }
      next.push(node);
    }
    return handled ? next : null;
  };

  return insertRelative(without) ?? [...without, removed];
}
