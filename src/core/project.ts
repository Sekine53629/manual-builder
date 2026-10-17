// プロジェクト（manual.json + 素材フォルダ）→ Manual の組み立て。
// ファイルの読み方は呼び出し側（ブラウザ: File System Access API、CLI: fs）が ProjectFiles で与える
import { createEmptyManual, isStepsData, type Chapter, type Manual, type StepsData } from "./types";
import { extractTitle, stripBom } from "./markdown";
import { sanitizeSvg } from "./svg";
import { isMenuCatalog, type MenuCatalog } from "./catalog";
import { DEFAULT_CATALOG_TITLE } from "./catalog-page";

/** プロジェクトフォルダの標準構成 */
export const PROJECT_LAYOUT = {
  manifest: "manual.json",
  chapters: "chapters",
  images: "images",
  catalog: "catalog",
  output: "output",
} as const;

/** manual.json の章エントリ */
export interface ManifestChapter {
  /** 素材ファイルのパス（manifest からの相対）。"catalog" と書くとカタログ章 */
  file: string;
  group?: string;
  /** 表示タイトル（原稿のタイトルを言い換えるときだけ） */
  title?: string;
  /** 手順 JSON に無い項目を補う */
  source?: string;
  sub?: string;
}

/** manual.json 全体 */
export interface Manifest {
  title: string;
  subtitle?: string;
  author?: string;
  version?: string;
  revisedOn?: string;
  coverNotes?: string[];
  book?: boolean;
  /** グループ名に「第N章 」を並び順で自動付与する */
  autoNumberGroups?: boolean;
  catalog?: string;
  menuTree?: string;
  /** catalog.meta に上書きする値 */
  catalogMeta?: MenuCatalog["meta"];
  /** メニュー ID ごとの heading / intro の上書き */
  menus?: Record<string, { heading?: string; intro?: string }>;
  /** 画像（PNG 等）を探すフォルダ。再帰的に読む */
  images?: string[];
  /** 図（SVG）を探すフォルダ。再帰的に読む。省略時は images と同じ */
  figures?: string[];
  chapters: ManifestChapter[];
}

/** ファイルアクセスの抽象。パスは manifest のあるフォルダからの相対（"/" 区切り） */
export interface ProjectFiles {
  readText(path: string): Promise<string>;
  /** 画像を data URI で返す */
  readDataUri(path: string): Promise<string>;
  /** フォルダ配下のファイルパスを再帰的に列挙する（相対パス）。無いフォルダは空配列 */
  list(dir: string): Promise<string[]>;
}

export interface AssembledChapter {
  chapter: Chapter;
  /** 章の元ファイルパス（カタログ章は manifest.catalog のパス、無ければ undefined） */
  sourcePath?: string;
  /** 元ファイルの内容（エディタ表示用） */
  sourceText?: string;
  /** 読み込みに失敗したときのメッセージ（章はプレースホルダになる） */
  error?: string;
}

export interface AssembleResult {
  manual: Manual;
  chapters: AssembledChapter[];
  /** 読み込み時の警告（ファイルが無い、形式が違うなど） */
  warnings: string[];
}

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export function imageMimeType(path: string): string | undefined {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return IMAGE_MIME[ext];
}

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** 新しいプロジェクトの manual.json */
export function createDefaultManifest(title: string): Manifest {
  return {
    title,
    subtitle: "",
    author: "",
    version: "0.1",
    revisedOn: new Date().toISOString().slice(0, 10),
    coverNotes: [],
    book: true,
    autoNumberGroups: true,
    catalog: `${PROJECT_LAYOUT.catalog}/menus.json`,
    menuTree: `${PROJECT_LAYOUT.catalog}/menu-tree.txt`,
    images: [PROJECT_LAYOUT.images],
    chapters: [],
  };
}

export function isManifest(value: unknown): value is Manifest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  return typeof v.title === "string" && Array.isArray(v.chapters);
}

/** 「第3章 在庫・伝票」→「在庫・伝票」。自動採番のときに既存の番号を外す */
export function stripGroupNumber(name: string): string {
  return name.replace(/^第\s*\d+\s*章\s*/, "").trim();
}

/**
 * 章ごとのグループ表示名。連続する同じグループ名を 1 つの章とみなし、
 * 自動採番なら並び順に「第N章 名前」を付ける（空のグループ名はそのまま空）
 */
export function computeGroupLabels(groupNames: string[], autoNumber: boolean): string[] {
  const labels: string[] = [];
  let n = 0;
  let prevKey: string | undefined;
  let prevLabel = "";
  for (const raw of groupNames) {
    const name = raw.trim();
    const key = autoNumber ? stripGroupNumber(name) : name;
    if (prevKey !== undefined && key === prevKey) {
      labels.push(prevLabel);
      continue;
    }
    let label = name;
    if (autoNumber && name) {
      n += 1;
      label = `第${n}章 ${stripGroupNumber(name)}`.trim();
    }
    labels.push(label);
    prevKey = key;
    prevLabel = label;
  }
  return labels;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `p${idCounter}`;
}

/** manifest と素材から Manual を組み立てる */
export async function assembleManual(manifest: Manifest, files: ProjectFiles): Promise<AssembleResult> {
  try {
    const warnings: string[] = [];
    const manual = createEmptyManual(manifest.title);
    manual.subtitle = manifest.subtitle ?? "";
    manual.author = manifest.author ?? "";
    manual.version = manifest.version ?? "";
    manual.revisedOn = manifest.revisedOn ?? manual.revisedOn;
    manual.coverNotes = manifest.coverNotes ?? [];
    manual.book = manifest.book ?? false;
    manual.autoNumberGroups = manifest.autoNumberGroups ?? false;

    if (manifest.catalog) {
      try {
        const value: unknown = JSON.parse(stripBom(await files.readText(manifest.catalog)));
        if (!isMenuCatalog(value)) {
          warnings.push(`${manifest.catalog}: メニュー定義（menus + screens）ではありません`);
        } else {
          value.meta = { ...value.meta, ...manifest.catalogMeta };
          for (const [id, patch] of Object.entries(manifest.menus ?? {})) {
            const menu = value.menus.find((m) => m.id === id);
            if (menu) {
              Object.assign(menu, patch);
            } else {
              warnings.push(`menus.${id}: カタログに無いメニュー ID です`);
            }
          }
          manual.catalog = value;
        }
      } catch (error) {
        warnings.push(`${manifest.catalog} を読めません: ${(error as Error).message}`);
      }
    }
    if (manifest.menuTree) {
      try {
        manual.menuTree = stripBom(await files.readText(manifest.menuTree));
      } catch (error) {
        warnings.push(`${manifest.menuTree} を読めません: ${(error as Error).message}`);
      }
    }

    const imageDirs = manifest.images ?? [PROJECT_LAYOUT.images];
    const figureDirs = manifest.figures ?? imageDirs;
    for (const dir of imageDirs) {
      for (const path of await files.list(dir)) {
        if (imageMimeType(path)) {
          manual.images.push({ id: nextId(), name: basename(path), dataUri: await files.readDataUri(path) });
        }
      }
    }
    for (const dir of figureDirs) {
      for (const path of await files.list(dir)) {
        if (path.toLowerCase().endsWith(".svg")) {
          try {
            manual.figures.push({ id: nextId(), name: basename(path), svg: sanitizeSvg(stripBom(await files.readText(path)), basename(path)) });
          } catch (error) {
            warnings.push(`${path}: ${(error as Error).message}`);
          }
        }
      }
    }

    const chapters: AssembledChapter[] = [];
    for (const entry of manifest.chapters) {
      try {
        chapters.push(await loadChapter(entry, files, manual));
      } catch (error) {
        // 並び（manifest.chapters と同じ添字）を保つため、失敗した章はプレースホルダにする
        const message = (error as Error).message;
        warnings.push(`${entry.file}: ${message}`);
        const name = basename(entry.file);
        chapters.push({
          chapter: {
            id: nextId(),
            kind: "markdown",
            title: name,
            sourceName: name,
            group: entry.group ?? "",
            displayTitle: entry.title,
            markdown: `# ${name}\n\n> **読み込みエラー：** ${message}\n`,
          },
          sourcePath: entry.file,
          error: message,
        });
      }
    }
    manual.chapters = chapters.map((c) => c.chapter);
    return { manual, chapters, warnings };
  } catch (error) {
    console.error("[assembleManual] プロジェクトの組み立てに失敗しました:", error);
    throw error;
  }
}

async function loadChapter(entry: ManifestChapter, files: ProjectFiles, manual: Manual): Promise<AssembledChapter> {
  const group = entry.group ?? "";
  if (entry.file === "catalog") {
    const chapter: Chapter = {
      id: nextId(),
      kind: "catalog",
      title: manual.catalog?.meta?.title ?? DEFAULT_CATALOG_TITLE,
      sourceName: "catalog",
      group,
      displayTitle: entry.title,
    };
    return { chapter, sourcePath: undefined };
  }
  const sourceName = basename(entry.file);
  const lower = entry.file.toLowerCase();
  const text = stripBom(await files.readText(entry.file));
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    const chapter: Chapter = {
      id: nextId(),
      kind: "markdown",
      title: extractTitle(text, sourceName.replace(/\.(md|markdown)$/i, "")),
      sourceName,
      group,
      displayTitle: entry.title,
      markdown: text,
    };
    return { chapter, sourcePath: entry.file, sourceText: text };
  }
  if (lower.endsWith(".json")) {
    const value: unknown = JSON.parse(text);
    if (!isStepsData(value)) {
      throw new Error("手順 JSON（title + steps）ではありません");
    }
    const data: StepsData = { ...value };
    if (entry.source) {
      data.source = entry.source;
    }
    if (entry.sub) {
      data.sub = entry.sub;
    }
    const chapter: Chapter = { id: nextId(), kind: "steps", title: data.title, sourceName, group, displayTitle: entry.title, data };
    return { chapter, sourcePath: entry.file, sourceText: text };
  }
  throw new Error("対応していない拡張子です（.md / .json）");
}

/** 新しい Markdown 章のひな形 */
export function markdownTemplate(title: string): string {
  return `---\ntitle: ${title}\nsubtitle: \n---\n\n## 見出し\n\n本文\n`;
}

/** 新しい手順 JSON のひな形 */
export function stepsTemplate(title: string): string {
  const data: StepsData = {
    title,
    purpose: "",
    steps: [{ text: "", ui: [] }],
    cautions: [],
  };
  return `${JSON.stringify(data, null, 2)}\n`;
}
