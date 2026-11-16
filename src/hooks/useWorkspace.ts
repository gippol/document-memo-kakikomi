import { useCallback, useEffect, useRef, useState } from "react";
import { api, errMsg, type DocEntry } from "../lib/api";
import { CONFIG_FILE, DEFAULT_CONFIG, parseConfig, type FolderConfig } from "../lib/config";
import { loadDocument, type LoadedDoc } from "../lib/document";
import type { SlideSpan } from "../lib/dom";
import { NOTES_SUFFIX } from "../lib/notesFile";
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
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [doc, setDoc] = useState<LoadedDoc | null>(null);
  /** 描画後の表示テキスト（アンカーの基準。Markdown・Word・PowerPoint） */
  const [docText, setDocText] = useState<string | null>(null);
  /** PowerPoint: 各スライドが表示テキスト上で占める範囲 */
  const [slides, setSlides] = useState<SlideSpan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

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
      setDocs(await api.listDocuments(r));
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
        setDocs(list);
        setCurrentPath(null);
        setDoc(null);
        setDocText(null);
        resetNotes();
        setError(null);
        lsSet(LS_KEYS.lastRoot, r);
        await loadConfig(r);
        const last = lsGet(LS_KEYS.lastDoc(r));
        const initial = list.find((d) => d.path === last) ?? list[0];
        if (initial) await openDoc(initial.path);
      } catch (e) {
        setError(errMsg(e));
      }
    },
    [flushSave, openDoc, loadConfig, resetNotes],
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
  const onTextReady = useCallback((text: string, spans: SlideSpan[]) => {
    setSlides(spans);
    setDocText(text);
  }, []);

  // ---------- 外部での変更検知 ----------

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
          const view = (d: LoadedDoc) => (d.kind === "markdown" ? d.content : d.kind === "xlsx" ? d.sha256 : d.html);
          setDoc((prev) => (prev && prev.sha256 === c.sha256 && view(prev) === view(c) ? prev : c));
          setError(null);
        })
        .catch((e) => setError(`資料「${cur}」を読み込めません: ${errMsg(e)}（移動・削除された可能性があります）`));
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
    currentPath,
    doc,
    docText,
    slides,
    error,
    configError,
    notes,
    openFolder,
    openDoc,
    pickFolder,
    onTextReady,
  };
}
