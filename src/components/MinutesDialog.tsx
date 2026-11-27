import { useEffect, useMemo, useState } from "react";
import { api, copyText, errMsg } from "../lib/api";
import { buildMinutes, minutesFileName } from "../lib/minutes";
import { formatDate } from "../lib/noteMeta";
import { inSession, listSessions } from "../lib/session";
import type { NoteView } from "./NotesPanel";
import { SessionSelect } from "./SessionSelect";

interface Props {
  root: string;
  docPath: string;
  views: NoteView[];
  /** 最初に選んでおく会議の回（ノート一覧で選んでいる回。null はすべての回） */
  session: string | null;
  onClose(): void;
}

/**
 * ノートから作った議事録の Markdown を表示し、クリップボードへのコピーと .md での保存をする。
 * 表示した Markdown はその場で手直ししてからコピー・保存できる。
 */
export function MinutesDialog({ root, docPath, views, session: initialSession, onClose }: Props) {
  const [includeQuotes, setIncludeQuotes] = useState(true);
  // 開いている間に資料・ノートが再読込されても手直しが消えないよう、開いた時点のノートで作る
  const [snapshot] = useState(views);
  const sessions = useMemo(() => listSessions(snapshot.map((v) => v.note)), [snapshot]);
  const [session, setSession] = useState(initialSession);
  // ある回だけを書き出すときは、議事録の日付・ファイル名をその回の日にする
  const meetingDate = session ?? formatDate(new Date());
  const generated = useMemo(
    () =>
      buildMinutes(
        snapshot.filter((v) => inSession(v.note, session)),
        { docPath, today: new Date(), includeQuotes, meetingDate: session ?? undefined },
      ),
    [snapshot, session, docPath, includeQuotes],
  );
  const [text, setText] = useState(generated);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const edited = text !== generated;

  // 設定を変えたら作り直す（手直しは破棄される）
  useEffect(() => setText(generated), [generated]);

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

  const copy = async () => {
    try {
      await copyText(text);
      setStatus({ ok: true, msg: "クリップボードにコピーしました" });
    } catch (e) {
      setStatus({ ok: false, msg: errMsg(e) });
    }
  };

  const save = async () => {
    try {
      const path = await api.saveMinutes(root, docPath, minutesFileName(docPath, meetingDate), text);
      if (path) setStatus({ ok: true, msg: `保存しました: ${path}` });
    } catch (e) {
      setStatus({ ok: false, msg: errMsg(e) });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="議事録の書き出し"
        className="flex h-full max-h-[48rem] w-full max-w-4xl flex-col border border-line bg-bg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-2 py-1">
          <span className="text-bright">議事録の書き出し</span>
          {(sessions.length >= 2 || session !== null) && (
            <SessionSelect sessions={sessions} value={session} onChange={setSession} total={snapshot.length} />
          )}
          <label className="flex items-center gap-1 text-dim">
            <input type="checkbox" checked={includeQuotes} onChange={(e) => setIncludeQuotes(e.target.checked)} />
            資料の引用を含める
          </label>
          {edited && (
            <button onClick={() => setText(generated)} className="btn" title="手直しを破棄して作り直します">
              作り直す
            </button>
          )}
          <button onClick={onClose} className="btn ml-auto">
            閉じる
          </button>
        </div>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          className="flex-1 resize-none bg-bg p-2 font-mono text-bright caret-bright outline-none"
        />
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line px-2 py-1">
          <span className={`min-w-0 flex-1 truncate ${status ? (status.ok ? "text-fg" : "text-warn") : "text-dim"}`} title={status?.msg}>
            {status?.msg ?? "そのまま手直しできます。Esc: 閉じる"}
          </span>
          <button onClick={copy} className="btn">
            クリップボードにコピー
          </button>
          <button onClick={save} className="btn">
            .md で保存
          </button>
        </div>
      </div>
    </div>
  );
}
