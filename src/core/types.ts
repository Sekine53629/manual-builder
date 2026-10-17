// マニュアルのデータモデル
import type { MenuCatalog } from "./catalog";

/** 章の種類。1 つの取り込みファイル = 1 章 */
export type ChapterKind = "markdown" | "steps" | "catalog";

interface ChapterBase {
  id: string;
  kind: ChapterKind;
  /** 章タイトル（front matter の title、無ければ最初の # 見出し、無ければファイル名） */
  title: string;
  /** ファイル名（表示・重複判定用） */
  sourceName: string;
  /** 統合版でのグループ名（例: 第4章 在庫・伝票）。空なら未分類 */
  group: string;
  /** 出力時に title の代わりに使う表示タイトル（任意） */
  displayTitle?: string;
}

/** 出力に使う章タイトル（表示タイトルがあればそれ） */
export function chapterTitle(chapter: { title: string; displayTitle?: string }): string {
  return chapter.displayTitle?.trim() || chapter.title;
}

/** Markdown 原稿の章 */
export interface MarkdownChapter extends ChapterBase {
  kind: "markdown";
  markdown: string;
}

/** 操作手順（steps JSON）の章 */
export interface StepsChapter extends ChapterBase {
  kind: "steps";
  data: StepsData;
}

/** メニュー構成とアイコン一覧（catalog JSON から自動生成）の章 */
export interface CatalogChapter extends ChapterBase {
  kind: "catalog";
}

export type Chapter = MarkdownChapter | StepsChapter | CatalogChapter;

/** steps JSON の 1 手順 */
export interface Step {
  text: string;
  /** 操作経路の参照名（カタログの ref）の並び */
  ui?: string[];
  /** 手順の下に置く画像のファイル名（取り込んだ PNG/SVG を名前で参照） */
  images?: string[];
}

/** steps JSON 全体 */
export interface StepsData {
  title: string;
  /** 「使う場面」 */
  purpose?: string;
  /** 「原本：…」に表示する元資料名 */
  source?: string;
  /** サブタイトル行。省略時は source から組み立てる */
  sub?: string;
  steps: Step[];
  cautions?: string[];
  /** 作成メモ（出力しない） */
  notes?: string;
}

/** 1 つの SVG ファイル = 1 図。Markdown からはファイル名で参照する */
export interface Figure {
  id: string;
  /** 参照キー。拡張子込みのファイル名（例: flow.svg） */
  name: string;
  /** サニタイズ済み SVG 文字列 */
  svg: string;
}

/** PNG/JPEG などのラスタ画像。data URI で埋め込む */
export interface ImageAsset {
  id: string;
  /** 参照キー。拡張子込みのファイル名（例: m_zaiko_zuiji_F1.png） */
  name: string;
  dataUri: string;
}

export interface Manual {
  title: string;
  /** 表紙のサブタイトル */
  subtitle: string;
  /** 作成者 */
  author: string;
  version: string;
  /** 改定日 (YYYY-MM-DD) */
  revisedOn: string;
  /** 表紙に載せる補足（1 行 1 項目） */
  coverNotes: string[];
  /** true: 表紙・全体目次・章バッジ付きの統合版として出力する */
  book: boolean;
  /** true: グループ名に「第N章 」を並び順で自動付与する */
  autoNumberGroups: boolean;
  chapters: Chapter[];
  figures: Figure[];
  images: ImageAsset[];
  /** メニュー定義（チップ解決・カタログ章に使う） */
  catalog?: MenuCatalog;
  /** メニュー構成のツリー表示テキスト（カタログ章の第 1 節） */
  menuTree?: string;
}

export function createEmptyManual(title: string): Manual {
  return {
    title,
    subtitle: "",
    author: "",
    version: "0.1",
    revisedOn: new Date().toISOString().slice(0, 10),
    coverNotes: [],
    book: false,
    autoNumberGroups: false,
    chapters: [],
    figures: [],
    images: [],
  };
}

/** steps JSON らしさの判定（title と steps[] を持つ） */
export function isStepsData(value: unknown): value is StepsData {
  if (!value || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  return typeof v.title === "string" && Array.isArray(v.steps);
}
