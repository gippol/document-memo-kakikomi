/** 宿題・質問ボードと決定事項の台帳で共通の部品 */
import { useState, type ReactNode } from "react";
import { copyText, errMsg } from "../lib/api";
import type { FolderNote } from "../lib/board";

/** ダイアログの下端: 案内・結果の表示と「Markdown をコピー」 */
export function BoardFooter({ hint, disabled, markdown }: { hint: string; disabled: boolean; markdown(): string }) {
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const copy = async () => {
    try {
      await copyText(markdown());
      setStatus({ ok: true, msg: "Markdown をクリップボードにコピーしました" });
    } catch (e) {
      setStatus({ ok: false, msg: errMsg(e) });
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line px-2 py-1">
      <span className={`min-w-0 flex-1 truncate ${status ? (status.ok ? "text-fg" : "text-warn") : "text-dim"}`} title={status?.msg}>
        {status?.msg ?? hint}
      </span>
      <button onClick={copy} disabled={disabled} className="btn" title="表示中の一覧を Markdown でコピーします">
        Markdown をコピー
      </button>
    </div>
  );
}

/**
 * 一覧の 1 行（押すと該当箇所へ移動。資料が見つからなければ押せない）。
 * disabled で理由を渡すと押せない行にする。action は行の右に置くボタン、extra は行の下に添える内容
 */
export function BoardRow({
  item,
  onJump,
  children,
  title,
  disabled,
  action,
  extra,
}: {
  item: FolderNote;
  onJump(i: FolderNote): void;
  children: ReactNode;
  title?: string;
  disabled?: string;
  action?: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <li>
      <div className="flex items-baseline">
        <button
          onClick={() => onJump(item)}
          disabled={!item.docExists || !!disabled}
          title={
            disabled ??
            (item.docExists ? (title ?? `${item.docPath} の該当箇所へ移動`) : "資料が見つかりません（ファイル一覧の「孤立したノート」から付け替えられます）")
          }
          className={`flex min-w-0 flex-1 items-baseline gap-x-[1ch] px-1 text-left hover:bg-hl disabled:cursor-default disabled:hover:bg-transparent ${disabled ? "opacity-50" : ""}`}
        >
          {children}
        </button>
        {action}
      </div>
      {extra}
    </li>
  );
}

/** 資料のパスと位置（行の右端） */
export function SourceCell({ item }: { item: FolderNote }) {
  return (
    <span className="w-[32ch] shrink-0 truncate text-dim">
      {item.docPath}
      {item.where ? ` ${item.where}` : ""}
      {!item.docExists && " (資料なし)"}
    </span>
  );
}

/** 1 行目だけ（複数行のコメントは一覧では省略する） */
export function firstLine(s: string): string {
  const lines = s.trim().split(/\r?\n/);
  return lines.length > 1 ? `${lines[0]} …` : lines[0];
}
