/**
 * アプリの名前と版（画面に出すもの）。
 * 版は package.json から読む。package.json・src-tauri/Cargo.toml・src-tauri/tauri.conf.json の版と、
 * tauri.conf.json の名前・ウィンドウのタイトルがそろっていることは appInfo.test.ts で確かめる。
 *
 * 内部の名前（npm・Cargo のパッケージ名、実行ファイル名 document-memo-kakikomi.exe、識別子 com.document-memo-kakikomi.app、
 * localStorage・設定ファイルの名前）は英数字。識別子を変えるとアプリのデータ（開けるフォルダの一覧・
 * PDF のキャッシュ・前回開いたフォルダ・書いた人の名前）の置き場所が変わり、前のデータは引き継がれない。
 */
import { version } from "../../package.json";

export const APP_NAME = "資料メモ かきこみ";
export const APP_VERSION: string = version;
