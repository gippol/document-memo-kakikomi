import { useMemo, useState } from "react";
import {
  BOARD_TITLE,
  boardMarkdown,
  filterBoard,
  filterKind,
  groupBoard,
  isUnassigned,
  itemText,
  summarizeBoard,
  type BoardData,
  type BoardFilter,
  type BoardGrouping,
  type BoardItem,
  type BoardKind,
  type FolderNote,
} from "../lib/board";
import { DONE_LABEL, dueLabel, formatDate, KIND_LABEL, PRIORITY_LABEL } from "../lib/noteMeta";
import { BoardFooter, BoardRow, firstLine, SourceCell } from "./BoardParts";
import { KIND_STYLE, PRIORITY_STYLE } from "./NotesPanel";

interface Props {
  /** 読み込み中は null */
  data: BoardData | null;
  today: Date;
  onJump(item: FolderNote): void;
  /** 宿題を完了・質問を回答済みにする（done: false で戻す）。失敗したらエラーの文を返す */
  onSetDone(item: BoardItem, done: boolean): Promise<string | null>;
}

const FILTER_LABEL: Record<BoardFilter, string> = {
  all: "全部",
  overdue: "期限切れ",
  thisWeek: "今週",
  unassigned: "担当なし",
};

const FILTERS: BoardFilter[] = ["all", "overdue", "thisWeek", "unassigned"];

const KIND_NAME: Record<BoardKind, string> = { all: "宿題・質問", action: "宿題", question: "質問" };

const KINDS: [BoardKind, string, string][] = [
  ["all", "すべて", "未完了の宿題と未回答の質問"],
  ["action", "宿題", "未完了の宿題だけ"],
  ["question", "質問", "未回答の質問だけ（先生・担当者に聞くリスト）"],
];

/**
 * フォルダ全体の未完了の宿題・未回答の質問のボード。
 * 担当者別・期限順に並べ、期限切れ・今週・担当なしの件数を出す。行の右のボタンで完了（回答済み）にできる。
 */
export function TaskBoard({ data, today, onJump, onSetDone }: Props) {
  const [kind, setKind] = useState<BoardKind>("all");
  const [grouping, setGrouping] = useState<BoardGrouping>("assignee");
  const [filter, setFilter] = useState<BoardFilter>("all");
  /** 直前に完了・回答済みにしたもの（元に戻せる） */
  const [lastDone, setLastDone] = useState<BoardItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const todayStr = formatDate(today);

  const all = useMemo(() => data?.items ?? [], [data]);
  const items = useMemo(() => filterKind(all, kind), [all, kind]);
  const summary = useMemo(() => summarizeBoard(items, today), [items, today]);
  const groups = useMemo(() => groupBoard(filterBoard(items, filter, today), grouping, today), [items, filter, grouping, today]);
  const kindCount = (k: BoardKind) => filterKind(all, k).length;

  const count: Record<BoardFilter, number> = {
    all: summary.total,
    overdue: summary.overdue,
    thisWeek: summary.thisWeek,
    unassigned: summary.unassigned,
  };

  const setDone = async (item: BoardItem, done: boolean) => {
    const key = `${item.docPath}#${item.note.id}`;
    setBusy(key);
    const err = await onSetDone(item, done);
    setBusy(null);
    setError(err);
    if (!err) setLastDone(done ? item : null);
  };

  return (
    <>
      {/* 種類と並べ方 */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-2 py-1">
        <span className="text-dim">種類:</span>
        {KINDS.map(([k, label, title]) => (
          <button key={k} onClick={() => setKind(k)} title={title} className={`btn ${kind === k ? "on" : ""}`}>
            {label} {kindCount(k)}
          </button>
        ))}
        <span className="ml-auto text-dim">並べ方:</span>
        <button onClick={() => setGrouping("assignee")} className={`btn ${grouping === "assignee" ? "on" : ""}`}>
          担当者別
        </button>
        <button onClick={() => setGrouping("due")} className={`btn ${grouping === "due" ? "on" : ""}`}>
          期限順
        </button>
        <button onClick={() => setGrouping("priority")} className={`btn ${grouping === "priority" ? "on" : ""}`}>
          優先度別
        </button>
      </div>

      {/* 集計（押すと絞り込む） */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-2 py-1">
        <span className="text-dim">絞り込み:</span>
        {FILTERS.map((f) => {
          const warn = (f === "overdue" || f === "unassigned") && count[f] > 0;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`btn ${filter === f ? "on" : ""}`}
              title={f === "unassigned" ? "担当者が空の宿題（質問は数えません）" : f === "thisWeek" ? "今日から今週の日曜までが期限" : undefined}
            >
              <span className={warn && filter !== f ? "text-warn" : undefined}>
                {FILTER_LABEL[f]} {count[f]}件
              </span>
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 py-1">
        {!data && <p className="text-dim">読み込み中...</p>}
        {data && groups.length === 0 && (
          <p className="text-dim">
            {filter === "all" ? `${BOARD_TITLE[kind]}はありません` : `${FILTER_LABEL[filter]}の${KIND_NAME[kind]}はありません`}
          </p>
        )}
        {groups.map((g) => (
          <section key={g.key} className="mb-2">
            <h3 className={`border-b border-line ${g.warn ? "text-warn" : "text-bright"}`}>
              {g.warn ? "[!] " : ""}
              {g.label} <span className="text-dim">({g.items.length})</span>
            </h3>
            <ul>
              {g.items.map((i) => {
                const key = `${i.docPath}#${i.note.id}`;
                return (
                  <TaskRow
                    key={key}
                    item={i}
                    today={today}
                    todayStr={todayStr}
                    onJump={onJump}
                    busy={busy === key}
                    onDone={() => void setDone(i, true)}
                  />
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {(lastDone || error) && (
        <div role="status" className="flex items-center gap-1 border-t border-line bg-panel px-2 py-1">
          {error ? (
            <span className="min-w-0 flex-1 truncate text-warn" title={error}>
              [!] {error}
            </span>
          ) : (
            lastDone && (
              <>
                <span className="min-w-0 flex-1 truncate">
                  {DONE_LABEL[lastDone.kind]}にしました: <span className="text-bright">{firstLine(itemText(lastDone))}</span>
                  <span className="text-dim"> （{lastDone.docPath}）</span>
                </span>
                <button onClick={() => void setDone(lastDone, false)} className="btn shrink-0">
                  元に戻す
                </button>
              </>
            )
          )}
          <button
            onClick={() => {
              setLastDone(null);
              setError(null);
            }}
            className="btn shrink-0"
          >
            x
          </button>
        </div>
      )}

      <BoardFooter
        hint="項目を押すと該当箇所へ移動します。Esc: 閉じる"
        disabled={!data}
        markdown={() => boardMarkdown(groups, summary, today, filter === "all" ? BOARD_TITLE[kind] : `${BOARD_TITLE[kind]}（${FILTER_LABEL[filter]}）`)}
      />
    </>
  );
}

function TaskRow({
  item,
  today,
  todayStr,
  onJump,
  busy,
  onDone,
}: {
  item: BoardItem;
  today: Date;
  todayStr: string;
  onJump(i: FolderNote): void;
  busy: boolean;
  onDone(): void;
}) {
  const n = item.note;
  const overdue = !!n.due && n.due < todayStr;
  const unassigned = isUnassigned(item);
  const doneLabel = DONE_LABEL[item.kind] ?? "完了";
  return (
    <BoardRow
      item={item}
      onJump={onJump}
      action={
        <button
          onClick={onDone}
          disabled={busy || !item.docExists}
          className="btn shrink-0"
          title={`${doneLabel}にします（${item.docPath} のノートファイルに保存します）`}
        >
          {busy ? "保存中" : doneLabel}
        </button>
      }
    >
      <span className={`shrink-0 ${KIND_STYLE[item.kind]}`}>[{KIND_LABEL[item.kind]}]</span>
      <span className={`w-[2ch] shrink-0 ${n.priority ? PRIORITY_STYLE[n.priority] : ""}`} title={n.priority ? `優先度: ${PRIORITY_LABEL[n.priority]}` : undefined}>
        {n.priority ? PRIORITY_LABEL[n.priority] : ""}
      </span>
      <span className="min-w-0 flex-1 truncate text-bright">{firstLine(itemText(item))}</span>
      <span className={`shrink-0 ${unassigned ? "bg-warn px-1 text-bg" : n.assignee ? "text-fg" : "text-dim"}`}>
        {n.assignee ? `@${n.assignee}` : unassigned ? "担当なし" : "@--"}
      </span>
      <span className={`w-[9ch] shrink-0 ${overdue ? "text-warn" : n.due === todayStr ? "text-accent" : "text-fg"}`}>
        {n.due ? `〜${dueLabel(n.due, today)}` : ""}
      </span>
      <SourceCell item={item} />
    </BoardRow>
  );
}
