import { useMemo, useState } from "react";
import { itemText, sourceLabel, type FolderNote } from "../lib/board";
import { groupLedger, ledgerMarkdown, oneLineText, replacesLabel, searchLedger, withoutReplaced, type LedgerData, type LedgerOrder } from "../lib/ledger";
import { linkDecisions, noteKey, unpickable } from "../lib/supersede";
import { BoardFooter, BoardRow, firstLine, SourceCell } from "./BoardParts";
import type { PickSupersede } from "./FolderBoard";
import { KIND_STYLE } from "./NotesPanel";

interface Props {
  /** 読み込み中は null */
  data: LedgerData | null;
  today: Date;
  onJump(item: FolderNote): void;
  /** 指定すると、置き換え元を選ぶ画面にする（行を押すと onPick） */
  pick?: PickSupersede;
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
 * 決定を変えたとき（置き換え）は、前の決定を取り消し線にして、前後の決定へのリンクを添える。
 */
export function DecisionLedger({ data, today, onJump, pick }: Props) {
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<LedgerOrder>("newest");
  const [hideReplaced, setHideReplaced] = useState(false);

  const items = useMemo(() => data?.items ?? [], [data]);
  const links = useMemo(() => linkDecisions(items), [items]);
  const excluded = useMemo(() => (pick ? unpickable({ docPath: pick.docPath, note: { id: pick.noteId } }, links) : null), [pick, links]);
  const shown = useMemo(() => (hideReplaced ? withoutReplaced(items, links) : items), [items, links, hideReplaced]);
  const hits = useMemo(() => searchLedger(shown, query), [shown, query]);
  const groups = useMemo(() => groupLedger(hits, order), [hits, order]);
  const replacedCount = items.length - withoutReplaced(items, links).length;

  const choose = pick ? pick.onPick : onJump;

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
        <span className="text-dim">{query.trim() ? `${hits.length} / ${shown.length}件` : `${shown.length}件`}</span>
        {replacedCount > 0 && (
          <label className="flex items-center gap-1 text-dim" title="新しい決定で置き換えられた決定を一覧から除きます">
            <input type="checkbox" checked={hideReplaced} onChange={(e) => setHideReplaced(e.target.checked)} />
            置き換え済みを隠す（{replacedCount}）
          </label>
        )}
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
        {data && shown.length > 0 && hits.length === 0 && <p className="text-dim">「{query.trim()}」を含む決定事項はありません</p>}
        {groups.map((g) => (
          <section key={g.date} className="mb-2">
            <h3 className="border-b border-line text-bright">
              {g.date} <span className="text-dim">({g.items.length})</span>
            </h3>
            <ul>
              {g.items.map((i) => {
                const newer = links.replacedBy.get(noteKey(i)) ?? [];
                const replaced = newer.length > 0;
                const isSelf = pick && i.docPath === pick.docPath && i.note.id === pick.noteId;
                return (
                  <BoardRow
                    key={noteKey(i)}
                    item={i}
                    onJump={choose}
                    title={pick ? "この決定を置き換え元にする" : undefined}
                    disabled={
                      excluded?.has(noteKey(i))
                        ? isSelf
                          ? "この決定自身です"
                          : "この決定を置き換えた（新しい）決定なので選べません"
                        : undefined
                    }
                    extra={<LinkLines item={i} newer={newer} links={links} onJump={onJump} hidden={!!pick} />}
                  >
                    <span className={`shrink-0 ${KIND_STYLE.decision}`}>[決定]</span>
                    {replaced && <span className="shrink-0 text-dim">[置換済]</span>}
                    {isSelf && <span className="shrink-0 text-accent">[この決定]</span>}
                    <span className={`min-w-0 flex-1 truncate ${replaced ? "text-dim line-through" : "text-bright"}`} title={itemText(i)}>
                      {firstLine(itemText(i))}
                    </span>
                    <span className="w-[6ch] shrink-0 text-dim">{timeOf(i.note.createdAt)}</span>
                    <SourceCell item={i} />
                  </BoardRow>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {pick ? (
        <div className="border-t border-line px-2 py-1 text-dim">置き換え元にする（前の）決定を押してください。Esc: やめる</div>
      ) : (
        <BoardFooter
          hint="項目を押すと該当箇所へ移動します。Esc: 検索語を消す / 閉じる"
          disabled={!data}
          markdown={() => ledgerMarkdown(groups, today, query, links)}
        />
      )}
    </>
  );
}

/** 行の下に添える、置き換えの前後の決定（押すとその決定へ移動） */
function LinkLines({
  item,
  newer,
  links,
  onJump,
  hidden,
}: {
  item: FolderNote;
  newer: FolderNote[];
  links: ReturnType<typeof linkDecisions>;
  onJump(i: FolderNote): void;
  hidden: boolean;
}) {
  if (hidden) return null;
  const older = links.replaces.get(noteKey(item));
  const olderLabel = replacesLabel(item, links);
  if (!olderLabel && newer.length === 0) return null;
  const line = "flex w-full gap-x-[1ch] pl-[8ch] pr-1 text-left text-dim enabled:hover:bg-hl enabled:hover:text-fg";
  return (
    <>
      {olderLabel && (
        <button onClick={() => older && onJump(older)} disabled={!older?.docExists} className={line} title={older ? "置き換え元の決定へ移動" : undefined}>
          <span className="shrink-0">← 置き換え元:</span>
          <span className="min-w-0 truncate">{olderLabel}</span>
        </button>
      )}
      {newer.map((n) => (
        <button key={noteKey(n)} onClick={() => onJump(n)} disabled={!n.docExists} className={line} title="置き換え先の決定へ移動">
          <span className="shrink-0">→ 置き換え先:</span>
          <span className="min-w-0 truncate">
            {oneLineText(n)}（{sourceLabel(n)}）
          </span>
        </button>
      ))}
    </>
  );
}
