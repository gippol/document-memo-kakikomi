import { useMemo, useState } from "react";
import { itemText, type FolderNote } from "../lib/board";
import { groupLedger, ledgerMarkdown, searchLedger, type LedgerData, type LedgerOrder } from "../lib/ledger";
import { BoardFooter, BoardRow, firstLine, SourceCell } from "./BoardParts";
import { KIND_STYLE } from "./NotesPanel";

interface Props {
  /** 読み込み中は null */
  data: LedgerData | null;
  today: Date;
  onJump(item: FolderNote): void;
}

const INPUT = "border border-dim bg-bg px-1 text-bright caret-bright outline-none placeholder:text-dim focus:border-fg";

/** 作成日時の時刻（HH:MM） */
function timeOf(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * フォルダ全体の決定事項の台帳。日付ごとにまとめ、文字で検索できる。
 */
export function DecisionLedger({ data, today, onJump }: Props) {
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<LedgerOrder>("newest");

  const items = useMemo(() => data?.items ?? [], [data]);
  const hits = useMemo(() => searchLedger(items, query), [items, query]);
  const groups = useMemo(() => groupLedger(hits, order), [hits, order]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-2 py-1">
        <label className="flex min-w-0 flex-1 items-center gap-1">
          <span className="text-dim">検索:</span>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Esc は検索語があれば消すだけ（ダイアログは閉じない）
              if (e.key === "Escape" && query) {
                e.preventDefault();
                e.stopPropagation();
                setQuery("");
              }
            }}
            placeholder="内容・引用・資料名・見出し（空白区切りですべてを含むもの）"
            className={`min-w-0 flex-1 ${INPUT}`}
          />
        </label>
        <span className="text-dim">
          {query.trim() ? `${hits.length} / ${items.length}件` : `${items.length}件`}
        </span>
        <span className="text-dim">並べ方:</span>
        <button onClick={() => setOrder("newest")} className={`btn ${order === "newest" ? "on" : ""}`}>
          新しい順
        </button>
        <button onClick={() => setOrder("oldest")} className={`btn ${order === "oldest" ? "on" : ""}`}>
          古い順
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 py-1">
        {!data && <p className="text-dim">読み込み中...</p>}
        {data && items.length === 0 && <p className="text-dim">決定事項はありません（ノートの種類を「決定」にすると、ここに集まります）</p>}
        {data && items.length > 0 && hits.length === 0 && <p className="text-dim">「{query.trim()}」を含む決定事項はありません</p>}
        {groups.map((g) => (
          <section key={g.date} className="mb-2">
            <h3 className="border-b border-line text-bright">
              {g.date} <span className="text-dim">({g.items.length})</span>
            </h3>
            <ul>
              {g.items.map((i) => (
                <BoardRow key={`${i.docPath}#${i.note.id}`} item={i} onJump={onJump}>
                  <span className={`shrink-0 ${KIND_STYLE.decision}`}>[決定]</span>
                  <span className="min-w-0 flex-1 truncate text-bright" title={itemText(i)}>
                    {firstLine(itemText(i))}
                  </span>
                  <span className="w-[6ch] shrink-0 text-dim">{timeOf(i.note.createdAt)}</span>
                  <SourceCell item={i} />
                </BoardRow>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <BoardFooter
        hint="項目を押すと該当箇所へ移動します。Esc: 検索語を消す / 閉じる"
        disabled={!data}
        markdown={() => ledgerMarkdown(groups, today, query)}
      />
    </>
  );
}
