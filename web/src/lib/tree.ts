import type { TreeNode } from './api';
export type FileStat = Pick<TreeNode, 'mtime' | 'ctime' | 'size'>;

/** Clone only the ancestors of an existing file. Null requests a structural refresh. */
export function patchFileStat(root: TreeNode | null, path: string, stat: FileStat): TreeNode | null {
  if (!root) return null;
  if (root.path === path) {
    if (root.type !== 'file') return null;
    return root.mtime === stat.mtime && root.ctime === stat.ctime && root.size === stat.size ? root : { ...root, ...stat };
  }
  const index = root.children?.findIndex((child) => child.path === path || path.startsWith(child.path + '/')) ?? -1;
  if (index < 0) return null;
  const child = patchFileStat(root.children![index], path, stat);
  if (!child) return null;
  if (child === root.children![index]) return root;
  const children = [...root.children!]; children[index] = child;
  return { ...root, children };
}

export function filePaths(root: TreeNode): string[] {
  const paths: string[] = [];
  const walk = (node: TreeNode) => { if (node.type === 'file') paths.push(node.path); node.children?.forEach(walk); };
  walk(root);
  return paths;
}

/** Find a node by its vault-relative path anywhere in the tree (null if absent). */
export function findNode(root: TreeNode | null, path: string): TreeNode | null {
  if (!root || !path) return null;
  const stack: TreeNode[] = [...(root.children ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.path === path) return n;
    if (n.children) stack.push(...n.children);
  }
  return null;
}

/** True if the path resolves to a folder node in the tree. */
export function isFolderPath(root: TreeNode | null, path: string | null): boolean {
  return !!path && findNode(root, path)?.type === 'folder';
}

/**
 * Drop any path that is nested under another path in the set. Used before bulk
 * move/delete so a folder and one of its own children aren't both operated on
 * (the child would already be gone with the parent → a spurious error).
 */
export function pruneDescendants(paths: string[]): string[] {
  const sorted = [...new Set(paths)].sort((a, b) => a.length - b.length);
  const keep: string[] = [];
  for (const p of sorted) if (!keep.some((k) => p === k || p.startsWith(`${k}/`))) keep.push(p);
  return keep;
}
