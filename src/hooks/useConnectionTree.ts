import { useEffect, useMemo, useState } from "react";
import {
  blankProfile,
  ConnectionProfile,
  Selection,
  TreeNode,
} from "../types/connection";
import { loadTree, saveTree } from "../lib/storage";
import {
  collectFolderOptions,
  findConnection,
  findFolder,
  findParentFolderId,
  firstConnectionId,
  insertIntoFolder,
  isDescendantFolder,
  moveTreeNode,
  removeFromTree,
} from "../lib/tree";
import { DropPosition } from "../types/connection";

export function useConnectionTree() {
  const [tree, setTree] = useState<TreeNode[]>(loadTree);
  const [selection, setSelection] = useState<Selection>(() => {
    const first = firstConnectionId(loadTree());
    return first ? { kind: "connection", id: first } : null;
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const selected =
    selection?.kind === "connection"
      ? findConnection(tree, selection.id)
      : null;

  const folderOptions = useMemo(() => collectFolderOptions(tree), [tree]);

  useEffect(() => {
    saveTree(tree);
  }, [tree]);

  function toggleExpanded(key: string) {
    setExpanded((current) => {
      const next = new Set(current);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function expandFolder(id: string) {
    setExpanded((current) => new Set(current).add(`folder:${id}`));
  }

  function saveConnection(profile: ConnectionProfile, folderId: string | null) {
    setTree((current) => {
      const exists = Boolean(findConnection(current, profile.id));
      const without = exists
        ? removeFromTree(current, profile.id).nodes
        : current;
      return insertIntoFolder(without, folderId, {
        kind: "connection",
        profile,
      });
    });
    setSelection({ kind: "connection", id: profile.id });
  }

  function saveFolder(input: {
    id?: string;
    name: string;
    parentId: string | null;
  }) {
    const name = input.name.trim();
    if (!name) return;

    if (input.id) {
      setTree((current) => {
        const existing = findFolder(current, input.id!);
        const children = existing?.children ?? [];
        const without = removeFromTree(current, input.id!).nodes;
        const targetParent =
          input.parentId &&
          (input.parentId === input.id ||
            isDescendantFolder(current, input.id!, input.parentId))
            ? null
            : input.parentId;
        return insertIntoFolder(without, targetParent, {
          kind: "folder",
          id: input.id!,
          name,
          children,
        });
      });
      return;
    }

    const id = crypto.randomUUID();
    setTree((current) =>
      insertIntoFolder(current, input.parentId, {
        kind: "folder",
        id,
        name,
        children: [],
      }),
    );
    expandFolder(id);
  }

  function deleteNode(id: string) {
    setTree((current) => removeFromTree(current, id).nodes);
    if (
      (selection?.kind === "connection" && selection.id === id) ||
      (selection?.kind === "folder" && selection.id === id)
    ) {
      setSelection(null);
    }
  }

  function moveNode(dragId: string, targetId: string, position: DropPosition) {
    setTree((current) => moveTreeNode(current, dragId, targetId, position));
    if (position === "into") expandFolder(targetId);
  }

  function parentOf(id: string) {
    return findParentFolderId(tree, id) ?? null;
  }

  function createBlank(driver?: ConnectionProfile["driver"]) {
    return blankProfile(driver);
  }

  return {
    tree,
    selection,
    setSelection,
    selected,
    expanded,
    toggleExpanded,
    folderOptions,
    saveConnection,
    saveFolder,
    deleteNode,
    moveNode,
    parentOf,
    findConnection: (id: string) => findConnection(tree, id),
    findFolder: (id: string) => findFolder(tree, id),
    createBlank,
  };
}
