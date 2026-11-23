import { useMemo, useState } from "react";
import {
  boardMarkdown,
  filterBoard,
  groupBoard,
  isUnassigned,
  itemText,
  summarizeBoard,
  type BoardData,
  type BoardFilter,
  type BoardGrouping,
  type BoardItem,
  type FolderNote,
} from "../lib/board";
import { dueLabel, formatDate, KIND_LABEL } from "../lib/noteMeta";
import { BoardFooter, BoardRow, firstLine, SourceCell } from "./BoardParts";
import { KIND_STYLE } from "./NotesPanel";

interface Props {
  /** 読み込み中は null */
  data: BoardData | null;
  today: Date;
  onJump(item: FolderNote): void;
}

const FILTER_LABEL: Record<BoardFilter, string> = {
  all: "全部",
  overdue: "期限切れ",
  thisWeek: "今週",
  unassigned: "担当なし",
};

const FILTERS: BoardFilter[] = ["all", "overdue", "thisWeek", "unassigned"];

/**
 * フォルダ全体の未完了の宿題・未回答の質問のボード。
 * 担当者別・期限順に並べ、期限切れ・今週・担当なしの件数を出す。
 */
export function TaskBoard({ data, today, onJump }: Props) {
  const [grouping, setGrouping] = useState<BoardGrouping>("assignee");
  const [filter, setFilter] = useState<BoardFilter>("all");
  const todayStr = formatDate(today);

  const items = useMemo(() => data?.items ?? [], [data]);
  const summary = useMemo(() => summarizeBoard(items, today), [items, today]);
  const groups = useMemo(() => groupBoard(filterBoard(items, filter, today), grouping, today), [items, filter, grouping, today]);

  const count: Record<BoardFilter, number> = {
    all: summary.total,
    overdue: summary.overdue,
    thisWeek: summary.thisWeek,
    unassigned: summary.unassigned,
  };

  return (
    <>
      {/* 集計（押すと絞り込む）と並べ方 */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-2 py-1">
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
        <span className="ml-auto text-dim">並べ方:</span>
        <button onClick={() => setGrouping("assignee")} className={`btn ${grouping === "assignee" ? "on" : ""}`}>
          担当者別
        </button>
        <button onClick={() => setGrouping("due")} className={`btn ${grouping === "due" ? "on" : ""}`}>
          期限順
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 py-1">
        {!data && <p className="text-dim">読み込み中...</p>}
        {data && groups.length === 0 && (
          <p className="text-dim">{filter === "all" ? "未完了の宿題・質問はありません" : `${FILTER_LABEL[filter]}の宿題・質問はありません`}</p>
        )}
        {groups.map((g) => (
          <section key={g.key} className="mb-2">
            <h3 className={`border-b border-line ${g.warn ? "text-warn" : "text-bright"}`}>
              {g.warn ? "[!] " : ""}
              {g.label} <span className="text-dim">({g.items.length})</span>
            </h3>
            <ul>
              {g.items.map((i) => (
                <TaskRow key={`${i.docPath}#${i.note.id}`} item={i} today={today} todayStr={todayStr} onJump={onJump} />
              ))}
            </ul>
          </section>
        ))}
      </div>

      <BoardFooter
        hint="項目を押すと該当箇所へ移動します。Esc: 閉じる"
        disabled={!data}
        markdown={() => boardMarkdown(groups, summary, today, filter === "all" ? undefined : `未完了の宿題・質問（${FILTER_LABEL[filter]}）`)}
      />
    </>
  );
}

function TaskRow({ item, today, todayStr, onJump }: { item: BoardItem; today: Date; todayStr: string; onJump(i: FolderNote): void }) {
  const n = item.note;
  const overdue = !!n.due && n.due < todayStr;
  const unassigned = isUnassigned(item);
  return (
    <BoardRow item={item} onJump={onJump}>
      <span className={`shrink-0 ${KIND_STYLE[item.kind]}`}>[{KIND_LABEL[item.kind]}]</span>
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
