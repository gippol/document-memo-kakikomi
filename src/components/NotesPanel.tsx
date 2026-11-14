import { useEffect, useRef, useState } from "react";
import type { AnchorLocation, AnchorStatus } from "../lib/anchor";
import type { Note } from "../lib/notesFile";
import type { CellRange } from "../lib/sheet";

/** ノートが現在の資料で指している範囲 */
export type NoteTarget = { kind: "text"; start: number; end: number } | { kind: "cell"; sheet: string; range: CellRange };

export interface NoteView extends AnchorLocation {
  note: Note;
  status: AnchorStatus;
  /** 現在の資料の版と異なる版で作成されたノート */
  stale: boolean;
  /** 見つからない（orphaned）ときは null */
  target: NoteTarget | null;
  /** Excel: シート名とセル範囲（例: "予算!B3:D5"） */
  cell?: string;
  /** 「位置」順に並べるときのキー */
  sortKey: number;
}

export type SortMode = "position" | "timeline";

interface Props {
  items: NoteView[];
  activeId: string | null;
  /** 値が変わるたびにアクティブカードへスクロール＆点滅 */
  focusTick: number;
  draft: { quote: string } | null;
  hasSelection: boolean;
  sortMode: SortMode;
  onSortMode(m: SortMode): void;
  onAddFromSelection(): void;
  onDraftSave(comment: string): void;
  onDraftCancel(): void;
  onUpdate(id: string, comment: string): void;
  onDelete(id: string): void;
  onJump(id: string): void;
  onReattach(id: string): void;
}

const STATUS_TAG: Record<AnchorStatus, { label: string; title: string } | null> = {
  ok: null,
  moved: { label: "MOVED", title: "資料の変更で位置がずれていたため、文脈から再アンカーしました" },
  fuzzy: { label: "FUZZY", title: "引用した内容自体が書き換わっています。推定した箇所を表示しています" },
  orphaned: { label: "LOST", title: "資料から該当箇所が見つかりません" },
};

/** Markdown は行番号、Word は段落番号、Excel はセル範囲で位置を表す */
function lineLabel(v: NoteView) {
  if (v.status === "orphaned") return "---";
  if (v.cell) return v.cell;
  if (v.lineStart !== undefined) {
    return v.lineEnd && v.lineEnd !== v.lineStart ? `L${v.lineStart}-${v.lineEnd}` : `L${v.lineStart}`;
  }
  if (v.paragraph !== undefined) return `¶${v.paragraph}`;
  return "---";
}

function fmt(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function CommentEditor(props: { initial: string; onSave(v: string): void; onCancel(): void; saveLabel: string }) {
  const [value, setValue] = useState(props.initial);
  return (
    <div className="mt-1">
      <textarea
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            props.onSave(value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            props.onCancel();
          }
        }}
        rows={4}
        placeholder="Ctrl+Enter: 保存 / Esc: キャンセル"
        className="w-full resize-y border border-dim bg-bg p-1 text-bright caret-bright outline-none placeholder:text-dim focus:border-fg"
      />
      <div className="flex justify-end gap-1">
        <button onClick={props.onCancel} className="btn">
          キャンセル
        </button>
        <button onClick={() => props.onSave(value)} className="btn">
          {props.saveLabel}
        </button>
      </div>
    </div>
  );
}

function Quote({ text }: { text: string }) {
  return <div className="mt-1 line-clamp-3 whitespace-pre-line border-l-2 border-accent/70 pl-[1ch] text-dim">{text}</div>;
}

function NoteCard(props: {
  view: NoteView;
  active: boolean;
  flash: boolean;
  hasSelection: boolean;
  cardRef(el: HTMLDivElement | null): void;
  onUpdate(comment: string): void;
  onDelete(): void;
  onJump(): void;
  onReattach(): void;
}) {
  const { view, active } = props;
  const { note } = view;
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const tag = STATUS_TAG[view.status];

  return (
    <div
      ref={props.cardRef}
      className={`border-b border-line px-2 py-2 ${active ? "border-l-2 border-l-accent bg-panel" : "border-l-2 border-l-transparent"} ${
        props.flash ? "card-flash" : ""
      }`}
    >
      <div className="flex gap-[1ch] text-dim">
        <span className={active ? "text-accent" : ""}>{active ? ">" : " "}</span>
        <span className="text-accent">{note.id}</span>
        <span>{lineLabel(view)}</span>
        {tag && (
          <span className={view.status === "moved" ? "text-accent" : "text-warn"} title={tag.title}>
            [{tag.label}]
          </span>
        )}
        {view.stale && view.status === "ok" && <span title="ノート作成後に資料が更新されています">[OLD]</span>}
        <span className="ml-auto">{fmt(note.createdAt)}</span>
      </div>
      {view.heading && view.status !== "orphaned" && (
        <div className="truncate text-dim" title={view.heading}>
          § {view.heading}
        </div>
      )}
      <Quote text={note.anchor.quote} />

      {editing ? (
        <CommentEditor
          initial={note.comment}
          saveLabel="更新"
          onCancel={() => setEditing(false)}
          onSave={(v) => {
            props.onUpdate(v);
            setEditing(false);
          }}
        />
      ) : (
        <p className="mt-1 cursor-text whitespace-pre-wrap text-fg" onDoubleClick={() => setEditing(true)} title="ダブルクリックで編集">
          {note.comment || <span className="text-dim">(コメントなし)</span>}
        </p>
      )}

      {note.updatedAt !== note.createdAt && <div className="text-dim">updated {fmt(note.updatedAt)}</div>}

      {!editing && (
        <div className="mt-1 flex flex-wrap items-center gap-x-1">
          {confirmDelete ? (
            <>
              <span className="text-bright">削除しますか? </span>
              <button onClick={props.onDelete} className="btn">
                y
              </button>
              <button onClick={() => setConfirmDelete(false)} className="btn">
                n
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setEditing(true)} className="btn">
                編集
              </button>
              <button onClick={() => setConfirmDelete(true)} className="btn">
                削除
              </button>
              <button onClick={props.onJump} disabled={view.status === "orphaned"} className="btn">
                ジャンプ
              </button>
              {(view.status !== "ok" || view.stale) && (
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={props.onReattach}
                  disabled={!props.hasSelection}
                  title={props.hasSelection ? "現在の選択範囲にこのノートを付け直します" : "資料上でテキスト（Excel はセル）を選択すると付け直せます"}
                  className="btn"
                >
                  付け直す
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function NotesPanel(props: Props) {
  const { items, activeId, focusTick, draft } = props;
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const [flashId, setFlashId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeId || focusTick === 0) return;
    cardRefs.current.get(activeId)?.scrollIntoView({ block: "nearest" });
    setFlashId(activeId);
    const t = setTimeout(() => setFlashId(null), 800);
    return () => clearTimeout(t);
  }, [activeId, focusTick]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1">
        <span className="text-bright">NOTES ({items.length})</span>
        <span className="ml-auto text-dim">sort:</span>
        {(
          [
            ["position", "位置"],
            ["timeline", "新しい順"],
          ] as const
        ).map(([m, label]) => (
          <button key={m} onClick={() => props.onSortMode(m)} className={`btn ${props.sortMode === m ? "on" : ""}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {draft && (
          <div className="border-b border-line border-l-2 border-l-[#b9d7f2] bg-panel px-2 py-2">
            <div className="text-[#b9d7f2]">+ new note</div>
            <Quote text={draft.quote} />
            <CommentEditor initial="" saveLabel="追加" onSave={props.onDraftSave} onCancel={props.onDraftCancel} />
          </div>
        )}
        {items.length === 0 && !draft && (
          <p className="px-2 py-4 text-dim">
            -- ノートなし --
            <br />
            資料のテキスト（Excel はセル）を選択して Ctrl+M で追加
          </p>
        )}
        {items.map((v) => (
          <NoteCard
            key={v.note.id}
            view={v}
            active={v.note.id === activeId}
            flash={v.note.id === flashId}
            hasSelection={props.hasSelection}
            cardRef={(el) => {
              if (el) cardRefs.current.set(v.note.id, el);
              else cardRefs.current.delete(v.note.id);
            }}
            onUpdate={(c) => props.onUpdate(v.note.id, c)}
            onDelete={() => props.onDelete(v.note.id)}
            onJump={() => props.onJump(v.note.id)}
            onReattach={() => props.onReattach(v.note.id)}
          />
        ))}
      </div>

      <div className="border-t border-line px-2 py-1">
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={props.onAddFromSelection}
          disabled={!props.hasSelection}
          className="btn w-full"
        >
          + 選択範囲にノートを追加
        </button>
      </div>
    </div>
  );
}
