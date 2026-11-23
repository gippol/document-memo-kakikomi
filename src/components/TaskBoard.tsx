import { useEffect, useMemo, useState } from "react";
import { copyText, errMsg } from "../lib/api";
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
} from "../lib/board";
import { dueLabel, formatDate, KIND_LABEL } from "../lib/noteMeta";
import { KIND_STYLE } from "./NotesPanel";

interface Props {
  /** 読み込み中は null */
  data: BoardData | null;
  error: string | null;
  onJump(item: BoardItem): void;
  onClose(): void;
}

const FILTER_LABEL: Record<BoardFilter, string> = {
  all: "全部",
  overdue: "期限切れ",
  thisWeek: "今週",
  unassigned: "担当なし",
};

const FILTERS: BoardFilter[] = ["all", "overdue", "thisWeek", "unassigned"];

/** 1 行目だけ（複数行のコメントはボードでは省略する） */
const firstLine = (s: string) => {
  const lines = s.trim().split(/\r?\n/);
  return lines.length > 1 ? `${lines[0]} …` : lines[0];
};

/**
 * フォルダ全体の未完了の宿題・未回答の質問のボード。
 * 担当者別・期限順に並べ、期限切れ・今週・担当なしの件数を出す。項目を押すとその資料の該当箇所へ移動する。
 */
export function TaskBoard({ data, error, onJump, onClose }: Props) {
  const [grouping, setGrouping] = useState<BoardGrouping>("assignee");
  const [filter, setFilter] = useState<BoardFilter>("all");
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  // 日付が変わっても開いている間は同じ日で数える
  const [today] = useState(() => new Date());
  const todayStr = formatDate(today);

  const items = useMemo(() => data?.items ?? [], [data]);
  const summary = useMemo(() => summarizeBoard(items, today), [items, today]);
  const groups = useMemo(() => groupBoard(filterBoard(items, filter, today), grouping, today), [items, filter, grouping, today]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const count: Record<BoardFilter, number> = {
    all: summary.total,
    overdue: summary.overdue,
    thisWeek: summary.thisWeek,
    unassigned: summary.unassigned,
  };

  const copy = async () => {
    const title = filter === "all" ? undefined : `未完了の宿題・質問（${FILTER_LABEL[filter]}）`;
    try {
      await copyText(boardMarkdown(groups, summary, today, title));
      setStatus({ ok: true, msg: "Markdown をクリップボードにコピーしました" });
    } catch (e) {
      setStatus({ ok: false, msg: errMsg(e) });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="宿題・質問ボード"
        className="flex h-full max-h-[48rem] w-full max-w-5xl flex-col border border-line bg-bg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-2 py-1">
          <span className="text-bright">宿題・質問ボード</span>
          <span className="text-dim">フォルダ全体の未完了</span>
          <span className="ml-2 text-dim">並べ方:</span>
          <button onClick={() => setGrouping("assignee")} className={`btn ${grouping === "assignee" ? "on" : ""}`}>
            担当者別
          </button>
          <button onClick={() => setGrouping("due")} className={`btn ${grouping === "due" ? "on" : ""}`}>
            期限順
          </button>
          <button onClick={onClose} className="btn ml-auto">
            閉じる
          </button>
        </div>

        {/* 集計（押すと絞り込む） */}
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
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-2 py-1">
          {error && <p className="text-warn">[!] ノートファイルを読み込めません: {error}</p>}
          {!data && !error && <p className="text-dim">読み込み中...</p>}
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
                  <BoardRow key={`${i.docPath}#${i.note.id}`} item={i} today={today} todayStr={todayStr} onJump={onJump} />
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line px-2 py-1">
          <span className={`min-w-0 flex-1 truncate ${status ? (status.ok ? "text-fg" : "text-warn") : "text-dim"}`} title={status?.msg}>
            {status?.msg ??
              (data && data.unreadable.length > 0
                ? `[W] 読めないノートファイル ${data.unreadable.length}件: ${data.unreadable.join(", ")}`
                : "項目を押すと該当箇所へ移動します。Esc: 閉じる")}
          </span>
          <button onClick={copy} disabled={!data} className="btn" title="表示中の一覧を議事録と同じ形式の Markdown でコピーします">
            Markdown をコピー
          </button>
        </div>
      </div>
    </div>
  );
}

function BoardRow({ item, today, todayStr, onJump }: { item: BoardItem; today: Date; todayStr: string; onJump(i: BoardItem): void }) {
  const n = item.note;
  const overdue = !!n.due && n.due < todayStr;
  const unassigned = isUnassigned(item);
  return (
    <li>
      <button
        onClick={() => onJump(item)}
        disabled={!item.docExists}
        title={item.docExists ? `${item.docPath} の該当箇所へ移動` : "資料が見つかりません（ファイル一覧の「孤立したノート」から付け替えられます）"}
        className="flex w-full items-baseline gap-x-[1ch] px-1 text-left hover:bg-hl disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className={`shrink-0 ${KIND_STYLE[item.kind]}`}>[{KIND_LABEL[item.kind]}]</span>
        <span className="min-w-0 flex-1 truncate text-bright">{firstLine(itemText(item))}</span>
        <span className={`shrink-0 ${unassigned ? "bg-warn px-1 text-bg" : n.assignee ? "text-fg" : "text-dim"}`}>
          {n.assignee ? `@${n.assignee}` : unassigned ? "担当なし" : "@--"}
        </span>
        <span className={`w-[9ch] shrink-0 ${overdue ? "text-warn" : n.due === todayStr ? "text-accent" : "text-fg"}`}>
          {n.due ? `〜${dueLabel(n.due, today)}` : ""}
        </span>
        <span className="w-[32ch] shrink-0 truncate text-dim">
          {item.docPath}
          {item.where ? ` ${item.where}` : ""}
          {!item.docExists && " (資料なし)"}
        </span>
      </button>
    </li>
  );
}
