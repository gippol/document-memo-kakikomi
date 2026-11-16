import { useState } from "react";
import type { DocEntry, OrphanNotes as Orphan } from "../lib/api";
import { relinkCandidates, type RelinkReason } from "../lib/relink";

interface Props {
  orphans: Orphan[];
  docs: DocEntry[];
  onRelink(from: string, to: string): Promise<void>;
}

const REASON: Record<RelinkReason, string> = { moved: "移動?", renamed: "名前変更?" };

/**
 * 対応する資料が見つからないノートファイルの一覧。
 * 資料をリネーム・移動したときに、ノートを新しい資料へ付け替えられる。
 */
export function OrphanNotes({ orphans, docs, onRelink }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  if (orphans.length === 0) return null;

  const toggle = (path: string) => {
    setOpen((p) => (p === path ? null : path));
    setTarget("");
  };

  const run = async (from: string) => {
    if (!target) return;
    setBusy(true);
    try {
      await onRelink(from, target);
      setOpen(null);
      setTarget("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-t border-line py-1" aria-label="孤立したノート">
      <p className="px-1 text-dim" title="資料のリネーム・移動・削除で、対応する資料が見つからなくなったノートファイル">
        -- 孤立したノート ({orphans.length}) --
      </p>
      {orphans.map((o) => {
        const candidates = open === o.path ? relinkCandidates(o.path, docs) : [];
        const targetDoc = docs.find((d) => d.path === target);
        return (
          <div key={o.path}>
            <button
              onClick={() => toggle(o.path)}
              className={`flex w-full gap-[1ch] px-1 text-left hover:bg-hl ${open === o.path ? "text-bright" : ""}`}
              title={`${o.path}（この資料が見つかりません）`}
            >
              <span>?</span>
              <span className="truncate">{o.path}</span>
              <span className="ml-auto shrink-0 text-dim">{o.noteCount === null ? "読めない" : `${o.noteCount}件`}</span>
            </button>
            {open === o.path && (
              <div className="space-y-1 px-1 pb-2 pl-[3ch]">
                <p className="text-dim">付け替え先:</p>
                {candidates.map((c) => (
                  <button
                    key={c.doc.path}
                    onClick={() => setTarget(c.doc.path)}
                    className={`flex w-full gap-[1ch] px-1 text-left hover:bg-hl ${target === c.doc.path ? "bg-fg text-bg" : ""}`}
                    title={c.doc.path}
                  >
                    <span className="truncate">{c.doc.path}</span>
                    <span className="ml-auto shrink-0 text-dim">{REASON[c.reason]}</span>
                  </button>
                ))}
                <select
                  value={candidates.some((c) => c.doc.path === target) ? "" : target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="w-full border border-line bg-bg text-fg"
                >
                  <option value="">{candidates.length > 0 ? "その他の資料..." : "資料を選択..."}</option>
                  {docs.map((d) => (
                    <option key={d.path} value={d.path}>
                      {d.path}
                      {d.hasNotes ? " *" : ""}
                    </option>
                  ))}
                </select>
                {targetDoc && (
                  <p className="text-dim">
                    {targetDoc.hasNotes ? "既存のノートに統合します。" : ""}元のノートファイルは削除します。
                  </p>
                )}
                <div className="flex gap-1">
                  <button onClick={() => void run(o.path)} disabled={!target || busy} className="btn">
                    {busy ? "付け替え中..." : "付け替え"}
                  </button>
                  <button onClick={() => toggle(o.path)} className="btn">
                    やめる
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
