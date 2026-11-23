import { useCallback, useEffect, useRef, useState } from "react";
import { api, errMsg, NOTES_CONFLICT, type DocEntry, type OrphanNotes } from "../lib/api";
import { CONFIG_FILE, DEFAULT_CONFIG, parseConfig, type FolderConfig } from "../lib/config";
import { loadDocument, type LoadedDoc } from "../lib/document";
import type { PageSpan, SlideSpan } from "../lib/dom";
import type { HeadingSpan } from "../lib/place";
import { mergeNotesFiles, NOTES_SUFFIX, parseNotesFile, serializeNotesFile } from "../lib/notesFile";
import { LS_KEYS, lsGet, lsSet } from "../lib/storage";
import { useNotesStore } from "./useNotesStore";

interface Options {
  /** 別の資料を開く直前（選択・下書きなど、資料に結びついた画面の状態を消す） */
  onBeforeOpen(): void;
}

/** 資料一覧の再読み込みが必要な変更か（資料・ノートファイル・拡張子の無いもの＝フォルダ） */
const TREE_CHANGE = /\.(md|markdown|docx|pptx|xlsx|xlsm|xls|notes\.json)$/i;

/**
 * 開いている資料フォルダと資料、そのノート。
 * - フォルダを開く（前回のフォルダ・資料を復元する）
 * - フォルダ直下の設定ファイルを読む
 * - 外部での変更（資料・ノートファイル・設定ファイル・フォルダ構成）を検知して読み込み直す
 */
export function useWorkspace({ onBeforeOpen }: Options) {
  const [root, setRoot] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocEntry[]>([]);
  /** 対応する資料が見つからないノートファイル */
  const [orphans, setOrphans] = useState<OrphanNotes[]>([]);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [doc, setDoc] = useState<LoadedDoc | null>(null);
  /** 描画後の表示テキスト（アンカーの基準。Markdown・Word・PowerPoint） */
  const [docText, setDocText] = useState<string | null>(null);
  /** PowerPoint: 各スライドが表示テキスト上で占める範囲 */
  const [slides, setSlides] = useState<SlideSpan[]>([]);
  /** PDF のページ（PDF のときだけ中身がある） */
  const [pages, setPages] = useState<PageSpan[]>([]);
  /** Word・Markdown の見出しの位置（全体メモの付け先を探すのに使う） */
  const [headings, setHeadings] = useState<HeadingSpan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  /** 操作の結果のお知らせ（閉じるまで表示） */
  const [notice, setNotice] = useState<string | null>(null);

  const rootRef = useRef<string | null>(null);
  const pathRef = useRef<string | null>(null);
  const configRef = useRef<FolderConfig>(DEFAULT_CONFIG);
  const onBeforeOpenRef = useRef(onBeforeOpen);
  onBeforeOpenRef.current = onBeforeOpen;

  const notes = useNotesStore({
    rootRef,
    pathRef,
    onWritten: (path) => setDocs((ds) => ds.map((d) => (d.path === path && !d.hasNotes ? { ...d, hasNotes: true } : d))),
  });
  const { loadNotes, flushSave, reset: resetNotes, onExternalChange: onNotesChanged } = notes;

  // ---------- 資料の読み込み ----------

  /** フォルダ直下の .document-memo-kakikomi.json を読む。壊れていても既定値で続行する */
  const loadConfig = useCallback(async (r: string) => {
    let next = DEFAULT_CONFIG;
    try {
      const json = await api.readConfig(r);
      if (json !== null) next = parseConfig(json);
      setConfigError(null);
    } catch (e) {
      setConfigError(`設定ファイル ${CONFIG_FILE}: ${errMsg(e)}（既定の設定で表示しています）`);
    }
    configRef.current = next;
  }, []);

  const docOptions = () => ({ docxHeadings: configRef.current.docxHeadings });

  const openDoc = useCallback(
    async (path: string) => {
      const r = rootRef.current;
      if (!r) return;
      await flushSave();
      onBeforeOpenRef.current();
      try {
        const content = await loadDocument(r, path, docOptions());
        // 前の資料の表示テキストで新しい資料のアンカーを解決しないよう、描画し終えるまで空にする
        // （Viewer は資料ごとに作り直すので、描画し終えると必ず onTextReady が呼ばれる）
        if (pathRef.current !== path) setDocText(null);
        pathRef.current = path;
        setCurrentPath(path);
        setDoc(content);
        await loadNotes(r, path);
        setError(null);
        lsSet(LS_KEYS.lastDoc(r), path);
      } catch (e) {
        setError(errMsg(e));
      }
    },
    [flushSave, loadNotes],
  );

  const refreshDocs = useCallback(async () => {
    const r = rootRef.current;
    if (!r) return;
    try {
      const list = await api.listDocuments(r);
      if (rootRef.current !== r) return;
      setDocs(list.docs);
      setOrphans(list.orphans);
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  const openFolder = useCallback(
    async (r: string) => {
      await flushSave();
      try {
        // バックエンドにフォルダを登録してから読む（登録したフォルダ以外は読み書きできない）
        await api.openFolder(r);
        const list = await api.listDocuments(r);
        rootRef.current = r;
        pathRef.current = null;
        setRoot(r);
        setDocs(list.docs);
        setOrphans(list.orphans);
        setNotice(null);
        setCurrentPath(null);
        setDoc(null);
        setDocText(null);
        resetNotes();
        setError(null);
        lsSet(LS_KEYS.lastRoot, r);
        await loadConfig(r);
        const last = lsGet(LS_KEYS.lastDoc(r));
        const initial = list.docs.find((d) => d.path === last) ?? list.docs[0];
        if (initial) await openDoc(initial.path);
      } catch (e) {
        setError(errMsg(e));
      }
    },
    [flushSave, openDoc, loadConfig, resetNotes],
  );

  /**
   * 孤立したノートファイル（from: 元の資料のパス）を資料 to に付け替える。
   * to に既にノートがあれば統合する。to へ書き込めてから元のファイルを消す
   * （どちらも読んだときの内容から外部で変更されていたら中止する）。
   */
  const relinkNotes = useCallback(
    async (from: string, to: string) => {
      const r = rootRef.current;
      if (!r) return;
      await flushSave();
      let wrote = false;
      try {
        const fromJson = await api.readNotes(r, from);
        if (fromJson === null) throw new Error(`${from}${NOTES_SUFFIX} が見つかりません`);
        const toJson = await api.readNotes(r, to);
        let source, target;
        try {
          source = parseNotesFile(fromJson, from);
          target = toJson === null ? null : parseNotesFile(toJson, to);
        } catch (e) {
          throw new Error(`ノートファイルを読み込めないため付け替えできません（${errMsg(e)}）`);
        }
        const merged = mergeNotesFiles(target, source, to);
        await api.writeNotes(r, to, serializeNotesFile(merged), toJson);
        wrote = true;
        await api.deleteOrphanNotes(r, from, fromJson);
        const count = source.notes.length + source.invalid.length;
        setNotice(`${from} のノート ${count}件を ${to} に${target ? "統合" : "付け替え"}しました`);
      } catch (e) {
        const msg =
          e === NOTES_CONFLICT
            ? "付け替えの途中でノートファイルが外部で変更されました。一覧を更新したので、もう一度お試しください"
            : errMsg(e);
        setNotice(
          wrote
            ? `${to} へのノートの書き込みは完了しましたが、元の ${from}${NOTES_SUFFIX} を削除できませんでした: ${msg}`
            : `ノートの付け替えに失敗しました: ${msg}`,
        );
      }
      await refreshDocs();
      if (wrote && pathRef.current === to) await loadNotes(r, to).catch((e) => setError(errMsg(e)));
    },
    [flushSave, refreshDocs, loadNotes],
  );

  const pickFolder = async () => {
    const r = await api.pickFolder();
    if (r) await openFolder(r);
  };

  // 前回開いていたフォルダを開く
  useEffect(() => {
    const last = lsGet(LS_KEYS.lastRoot);
    if (last) void openFolder(last);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Viewer が描画し終えた表示テキストを受け取る */
  const onTextReady = useCallback((text: string, spans: SlideSpan[], ps: PageSpan[], hs: HeadingSpan[]) => {
    setSlides(spans);
    setPages(ps);
    setHeadings(hs);
    setDocText(text);
  }, []);

  // ---------- 外部での変更検知 ----------

  // PDF のページ画像（blob URL）は、表示しなくなったら解放する
  // （StrictMode で effect が 2 回走っても、表示中の URL は解放しない）
  const shownPdfUrls = useRef<string[]>([]);
  useEffect(() => {
    const prev = shownPdfUrls.current;
    const cur = doc?.kind === "pdf" ? doc.urls : [];
    shownPdfUrls.current = cur;
    if (prev !== cur) prev.forEach((u) => URL.revokeObjectURL(u));
  }, [doc]);

  const handleFsChange = useRef<(paths: string[]) => void>(() => {});
  const treeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  handleFsChange.current = (paths: string[]) => {
    const r = rootRef.current;
    const cur = pathRef.current;
    if (!r) return;

    if (paths.some((p) => TREE_CHANGE.test(p) || !/\.[^/]+$/.test(p))) {
      if (treeTimer.current) clearTimeout(treeTimer.current);
      treeTimer.current = setTimeout(() => void refreshDocs(), 300);
    }
    if (!cur) return;

    const configChanged = paths.includes(CONFIG_FILE);
    if (paths.includes(cur) || configChanged) {
      (configChanged ? loadConfig(r) : Promise.resolve())
        .then(() => loadDocument(r, cur, docOptions()))
        .then((c) => {
          if (pathRef.current !== cur) return;
          // 表示内容が同じなら再描画しない（Word は見出し設定の変更でハッシュは同じでも HTML が変わる）
          // PDF のページ画像の URL は読み込むたびに変わるので比べない
          const view = (d: LoadedDoc) =>
            d.kind === "markdown" ? d.content : d.kind === "xlsx" ? d.sha256 : d.kind === "pdf" ? d.html.replace(/blob:[^"]*/g, "") : d.html;
          setDoc((prev) => {
            if (prev && prev.sha256 === c.sha256 && view(prev) === view(c)) {
              if (c.kind === "pdf") c.urls.forEach((u) => URL.revokeObjectURL(u));
              return prev;
            }
            return c;
          });
          setError(null);
        })
        .catch((e) => setError(`資料「${cur}」を読み込めません: ${errMsg(e)}（移動・削除された可能性があります。リネーム・移動した場合は、一覧の「孤立したノート」から新しい資料へノートを付け替えられます）`));
    }
    if (paths.includes(cur + NOTES_SUFFIX)) onNotesChanged(r, cur);
  };

  useEffect(() => {
    const un = api.onFsChanged((paths) => handleFsChange.current(paths));
    return () => {
      void un.then((f) => f());
    };
  }, []);

  return {
    root,
    docs,
    orphans,
    currentPath,
    doc,
    docText,
    slides,
    pages,
    headings,
    error,
    configError,
    notice,
    dismissNotice: () => setNotice(null),
    relinkNotes,
    notes,
    openFolder,
    openDoc,
    pickFolder,
    onTextReady,
  };
}
