// 表紙デザイン：A4 ページ上に要素（画像・テキスト・帯・収録内容）を mm 座標で置く
import { computeGroupLabels } from "./project";
import { findImage, imageKey } from "./catalog";
import type { Manual } from "./types";
import { escapeHtml, joinHtml } from "./html";

/** A4 縦のページサイズ（mm） */
export const COVER_PAGE = { width: 210, height: 297 } as const;

export type CoverElementType = "text" | "image" | "rect" | "contents" | "notes";

export interface CoverElement {
  id: string;
  type: CoverElementType;
  /** 左上の位置（mm） */
  x: number;
  y: number;
  /** 幅（mm）。省略時は内容に合わせる */
  w?: number;
  /** 高さ（mm）。rect / image で使う。省略時は内容に合わせる */
  h?: number;
  /** text: 本文。{title} {subtitle} {author} {date} {version} {count} を展開する */
  text?: string;
  /** image: 取り込んだ画像のファイル名 */
  src?: string;
  /** 文字サイズ（pt） */
  fontSize?: number;
  color?: string;
  background?: string;
  align?: "left" | "center" | "right";
  weight?: "normal" | "bold";
  /** 角丸（mm） */
  radius?: number;
  lineHeight?: number;
  /** 表示順。大きいほど手前 */
  z?: number;
}

export interface CoverDesign {
  /** ページ全体の背景色 */
  background?: string;
  elements: CoverElement[];
}

export function isCoverDesign(value: unknown): value is CoverDesign {
  if (!value || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  return Array.isArray(v.elements) && v.elements.every((e) => e && typeof e === "object" && typeof (e as CoverElement).type === "string");
}

/** 現行の表紙（青い帯・作成者行・補足・収録内容）と同じ見た目の既定デザイン */
export function defaultCoverDesign(manual: Manual): CoverDesign {
  const metaParts: string[] = [];
  if (manual.author) {
    metaParts.push("作成：{author}");
  }
  metaParts.push("{date}");
  if (manual.version) {
    metaParts.push("版 {version}");
  }
  const elements: CoverElement[] = [
    { id: "band", type: "rect", x: 15, y: 16, w: 180, h: 70, background: "#2b6cb0", radius: 1 },
    { id: "title", type: "text", x: 25, y: 58, w: 160, text: "{title}", fontSize: 24, color: "#ffffff", weight: "bold" },
    { id: "subtitle", type: "text", x: 25, y: 72, w: 160, text: "{subtitle}", fontSize: 12, color: "#ffffff" },
    { id: "meta", type: "text", x: 15, y: 100, w: 180, text: metaParts.join("　／　"), fontSize: 10 },
    { id: "notes", type: "notes", x: 15, y: 108, w: 180, fontSize: 10 },
    { id: "contents", type: "contents", x: 15, y: 128, w: 180, fontSize: 11 },
  ];
  return { elements };
}

function formatJapaneseDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : iso;
}

/** {title} などのプレースホルダを展開する（展開後に HTML エスケープする） */
export function expandPlaceholders(text: string, manual: Manual): string {
  const labels = computeGroupLabels(
    manual.chapters.map((c) => c.group),
    manual.autoNumberGroups,
  );
  const values: Record<string, string> = {
    title: manual.title,
    subtitle: manual.subtitle,
    author: manual.author,
    date: formatJapaneseDate(manual.revisedOn),
    version: manual.version,
    count: String(manual.chapters.length),
    groups: String(new Set(labels.filter(Boolean)).size),
  };
  return text.replace(/\{(\w+)\}/g, (m, key: string) => (key in values ? values[key] : m));
}

const mm = (v: number) => `${Number(v.toFixed(2))}mm`;

function styleOf(el: CoverElement): string {
  const parts = [`left:${mm(el.x)}`, `top:${mm(el.y)}`];
  if (el.w !== undefined) {
    parts.push(`width:${mm(el.w)}`);
  }
  if (el.h !== undefined) {
    parts.push(`height:${mm(el.h)}`);
  }
  if (el.fontSize !== undefined) {
    parts.push(`font-size:${el.fontSize}pt`);
  }
  if (el.color) {
    parts.push(`color:${el.color}`);
  }
  if (el.background) {
    parts.push(`background:${el.background}`);
  }
  if (el.align) {
    parts.push(`text-align:${el.align}`);
  }
  if (el.weight) {
    parts.push(`font-weight:${el.weight === "bold" ? 700 : 400}`);
  }
  if (el.radius !== undefined) {
    parts.push(`border-radius:${mm(el.radius)}`);
  }
  if (el.lineHeight !== undefined) {
    parts.push(`line-height:${el.lineHeight}`);
  }
  if (el.z !== undefined) {
    parts.push(`z-index:${el.z}`);
  }
  return parts.map((p) => escapeHtml(p)).join(";");
}

export interface CoverRenderOptions {
  /** true: 要素に data-el を付け、エディタでドラッグできるようにする */
  editable?: boolean;
}

/** 表紙を HTML にする。design を省略すると既定デザイン */
export function renderCover(manual: Manual, design: CoverDesign | undefined, options: CoverRenderOptions = {}): string {
  try {
    const d = design ?? defaultCoverDesign(manual);
    const sorted = [...d.elements].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
    const body = joinHtml(sorted, (el) => renderElement(el, manual, options.editable === true));
    const pageStyle = d.background ? ` style="background:${escapeHtml(d.background)}"` : "";
    const editable = options.editable ? ' data-mb-cover="1"' : "";
    return `<section class="cover cover-page"${pageStyle}${editable}>\n${body}\n</section>`;
  } catch (error) {
    console.error("[renderCover] 表紙の生成に失敗しました:", error);
    throw error;
  }
}

function renderElement(el: CoverElement, manual: Manual, editable: boolean): string {
  const attrs = `class="cover-el cover-${escapeHtml(el.type)}" style="${styleOf(el)}"${editable ? ` data-el="${escapeHtml(el.id)}"` : ""}`;
  switch (el.type) {
    case "rect":
      return `<div ${attrs}></div>`;
    case "image": {
      const asset = el.src ? findImage(el.src, manual.images) : undefined;
      if (asset) {
        return `<div ${attrs}><img src="${asset.dataUri}" alt=""></div>`;
      }
      // SVG（図）はインラインで埋め込む
      const key = el.src ? imageKey(el.src) : "";
      const figure = manual.figures.find((f) => imageKey(f.name) === key);
      if (figure) {
        return `<div ${attrs}>${figure.svg}</div>`;
      }
      return `<div ${attrs}><span class="cover-missing">[画像がありません: ${escapeHtml(el.src ?? "")}]</span></div>`;
    }
    case "text": {
      const text = escapeHtml(expandPlaceholders(el.text ?? "", manual)).replace(/\n/g, "<br>");
      return `<div ${attrs}>${text}</div>`;
    }
    case "notes": {
      const notes = manual.coverNotes.filter((n) => n.trim());
      return `<div ${attrs}>${joinHtml(notes, (n) => `<p>${escapeHtml(expandPlaceholders(n, manual))}</p>`)}</div>`;
    }
    case "contents": {
      const labels = computeGroupLabels(
        manual.chapters.map((c) => c.group),
        manual.autoNumberGroups,
      );
      const counts = new Map<string, number>();
      labels.forEach((label) => counts.set(label, (counts.get(label) ?? 0) + 1));
      const items = joinHtml(Array.from(counts.entries()), ([label, n]) => `<li>${escapeHtml(label || "（未分類）")}（${n}本）</li>`);
      return `<div ${attrs}><h3 class="cover-contents">収録内容（${manual.chapters.length}本）</h3><ul class="cover-list">${items}</ul></div>`;
    }
  }
}

/** 既定デザインを JSON テキストにする（cover.json のひな形） */
export function coverTemplate(manual: Manual): string {
  return `${JSON.stringify(defaultCoverDesign(manual), null, 2)}\n`;
}

/** 新しい要素のひな形（ページ中央付近に置く） */
export function newCoverElement(type: CoverElementType, id: string, src?: string): CoverElement {
  switch (type) {
    case "image":
      return { id, type, x: 80, y: 120, w: 50, src };
    case "rect":
      return { id, type, x: 15, y: 200, w: 180, h: 20, background: "#ebf4ff", radius: 1 };
    case "contents":
      return { id, type, x: 15, y: 128, w: 180, fontSize: 11 };
    case "notes":
      return { id, type, x: 15, y: 108, w: 180, fontSize: 10 };
    default:
      return { id, type: "text", x: 15, y: 150, w: 180, text: "テキスト", fontSize: 12 };
  }
}
