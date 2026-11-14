import { useMemo, useState } from "react";
import type { DocEntry } from "../lib/api";

interface TreeNode {
  name: string;
  path: string;
  doc?: DocEntry;
  children: TreeNode[];
}

function buildTree(docs: DocEntry[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: [] };
  for (const d of docs) {
    const parts = d.path.split("/");
    let cur = root;
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join("/");
      const isDir = i < parts.length - 1;
      let child = cur.children.find((c) => c.name === part && !c.doc === isDir);
      if (!child) {
        child = { name: part, path, children: [] };
        if (i === parts.length - 1) child.doc = d;
        cur.children.push(child);
      }
      cur = child;
    });
  }
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => (!!a.doc === !!b.doc ? a.name.localeCompare(b.name, "ja") : a.doc ? 1 : -1));
    n.children.forEach(sort);
  };
  sort(root);
  return root;
}

interface Props {
  docs: DocEntry[];
  current: string | null;
  onOpen(path: string): void;
}

export function FileTree({ docs, current, onOpen }: Props) {
  const tree = useMemo(() => buildTree(docs), [docs]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (p: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  const render = (node: TreeNode, depth: number) =>
    node.children.map((c) =>
      c.doc ? (
        <button
          key={c.path}
          onClick={() => onOpen(c.path)}
          className={`flex w-full gap-[1ch] truncate px-1 text-left ${
            current === c.path ? "bg-fg text-bg" : "text-fg hover:bg-hl"
          }`}
          style={{ paddingLeft: `${1 + depth * 2}ch` }}
          title={c.path}
        >
          <span className="truncate">{c.name}</span>
          {c.doc.hasNotes && (
            <span className={`ml-auto ${current === c.path ? "" : "text-dim"}`} title="ノートあり">
              *
            </span>
          )}
        </button>
      ) : (
        <div key={c.path}>
          <button
            onClick={() => toggle(c.path)}
            className="flex w-full gap-[1ch] truncate px-1 text-left text-dim hover:bg-hl"
            style={{ paddingLeft: `${1 + depth * 2}ch` }}
          >
            <span>{collapsed.has(c.path) ? "+" : "-"}</span>
            <span className="truncate">{c.name}/</span>
          </button>
          {!collapsed.has(c.path) && render(c, depth + 1)}
        </div>
      ),
    );

  if (docs.length === 0) {
    return <p className="p-2 text-dim">-- 資料ファイル (.md / .docx / .xlsx) なし --</p>;
  }
  return <nav className="py-1">{render(tree, 0)}</nav>;
}
