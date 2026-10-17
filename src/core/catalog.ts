// メニュー定義（catalog JSON）と、操作経路チップ（[[chips:...]] / steps.ui）の解決
import type { ImageAsset } from "./types";
import { escapeHtml } from "./html";

export interface MenuItem {
  /** 参照名 `メニューID:キー` */
  ref: string;
  key: string;
  label: string;
  /** 押すと開く画面（カタログ章で「→ …」として表示） */
  opens?: string;
  button?: string;
  button_text?: string;
  /** 絵柄 PNG の相対パス。ファイル名で取り込み画像と照合する */
  pict?: string;
}

export interface Menu {
  id: string;
  title: string;
  path: string;
  /** カタログ章での見出し。省略時は title/path から組み立てる */
  heading?: string;
  /** カタログ章で見出しの下に置く説明文（任意） */
  intro?: string;
  items: MenuItem[];
}

export interface ScreenKey {
  key: string;
  label: string;
}

export interface Screen {
  screen: string;
  opened_from?: string;
  fkeys: ScreenKey[];
  /** 上記以外の文字列キーは「項目名：値」として表示する */
  [extra: string]: unknown;
}

/** カタログ章の文言（任意） */
export interface CatalogMeta {
  title?: string;
  sub?: string;
  intro?: string;
  /** 「まだ取得できていない部分」の箇条書き */
  pending?: string[];
  pendingNote?: string;
}

export interface MenuCatalog {
  menus: Menu[];
  screens: Screen[];
  meta?: CatalogMeta;
}

/** メインメニュー上部タブのメニュー ID（濃灰のタブチップ） */
export const MAIN_TAB_MENU_ID = "m_tabs";
/** 在庫メニュー上部タブのメニュー ID（緑のタブチップ） */
export const SUB_TAB_MENU_ID = "m_zaiko_tabs";
/** 画面内ファンクションキー参照の接頭辞 */
export const SCREEN_REF_PREFIX = "s:";

export function isMenuCatalog(value: unknown): value is MenuCatalog {
  if (!value || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  return Array.isArray(v.menus) && Array.isArray(v.screens);
}

/** 画像の参照キー（ファイル名のみ・小文字） */
export function imageKey(pathOrName: string): string {
  const base = pathOrName.split(/[?#]/)[0].split(/[\\/]/).pop() ?? pathOrName;
  try {
    return decodeURIComponent(base).toLowerCase();
  } catch {
    return base.toLowerCase();
  }
}

export type ResolvedRef =
  | { kind: "menu"; ref: string; menu: Menu; item: MenuItem }
  | { kind: "screen"; ref: string; screen: Screen; fkey: ScreenKey }
  | { kind: "missing"; ref: string };

/** `m_tabs:F10` / `s:伝票入力（明細入力中）:F12` 形式の参照を解決する */
export function resolveRef(ref: string, catalog: MenuCatalog | undefined): ResolvedRef {
  const trimmed = ref.trim();
  if (!catalog) {
    return { kind: "missing", ref: trimmed };
  }
  if (trimmed.startsWith(SCREEN_REF_PREFIX)) {
    const body = trimmed.slice(SCREEN_REF_PREFIX.length);
    const sep = body.lastIndexOf(":");
    if (sep > 0) {
      const screenName = body.slice(0, sep);
      const key = body.slice(sep + 1);
      const screen = catalog.screens.find((s) => s.screen === screenName);
      const fkey = screen?.fkeys.find((k) => k.key === key);
      if (screen && fkey) {
        return { kind: "screen", ref: trimmed, screen, fkey };
      }
    }
    return { kind: "missing", ref: trimmed };
  }
  for (const menu of catalog.menus) {
    const item = menu.items.find((i) => i.ref === trimmed);
    if (item) {
      return { kind: "menu", ref: trimmed, menu, item };
    }
  }
  return { kind: "missing", ref: trimmed };
}

export interface ChipContext {
  catalog?: MenuCatalog;
  images: ImageAsset[];
}

export interface ChipsResult {
  html: string;
  /** 解決できなかった参照名 */
  missing: string[];
  /** 絵柄画像が取り込まれていない参照名 */
  missingImages: string[];
}

function keyBadge(key: string): string {
  return key ? `<span class="k">${escapeHtml(key)}</span>` : "";
}

function ok(html: string, missingImages: string[] = []): ChipsResult {
  return { html, missing: [], missingImages };
}

/** 1 つの参照をチップ HTML にする */
export function renderChip(ref: string, context: ChipContext): ChipsResult {
  const resolved = resolveRef(ref, context.catalog);
  if (resolved.kind === "missing") {
    return {
      html: `<span class="chip missing" title="未登録の参照">${escapeHtml(resolved.ref)}</span>`,
      missing: [resolved.ref],
      missingImages: [],
    };
  }
  if (resolved.kind === "screen") {
    const title = escapeHtml(resolved.screen.screen);
    return ok(`<span class="chip key" title="${title}">${keyBadge(resolved.fkey.key)}${escapeHtml(resolved.fkey.label)}</span>`);
  }
  const { menu, item } = resolved;
  if (menu.id === MAIN_TAB_MENU_ID) {
    return ok(`<span class="chip tab">${keyBadge(item.key)}${escapeHtml(item.label)}</span>`);
  }
  if (menu.id === SUB_TAB_MENU_ID) {
    return ok(`<span class="chip ztab">${keyBadge(item.key)}${escapeHtml(item.label)}</span>`);
  }
  const missingImages: string[] = [];
  let img = "";
  if (item.pict) {
    const asset = findImage(item.pict, context.images);
    if (asset) {
      img = `<img src="${asset.dataUri}" alt="">`;
    } else {
      missingImages.push(resolved.ref);
    }
  }
  if (!item.key && !img) {
    return ok(`<span class="chip plain">${escapeHtml(item.label)}</span>`, missingImages);
  }
  const cls = item.key && !item.pict ? "chip key" : "chip";
  return ok(`<span class="${cls}">${img}${keyBadge(item.key)}${escapeHtml(item.label)}</span>`, missingImages);
}

/** 参照の並びを「チップ › チップ › …」の 1 行にする */
export function renderChips(refs: string[], context: ChipContext): ChipsResult {
  const parts = refs.map((r) => renderChip(r, context));
  const html = `<div class="chips">${parts.map((p) => p.html).join('<span class="arrow">›</span>')}</div>`;
  return {
    html,
    missing: parts.flatMap((p) => p.missing),
    missingImages: parts.flatMap((p) => p.missingImages),
  };
}

/** `[[chips:a, b]]` の中身をパースして参照の配列にする */
export function parseChipRefs(body: string): string[] {
  return body
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function findImage(pathOrName: string, images: ImageAsset[]): ImageAsset | undefined {
  const key = imageKey(pathOrName);
  return images.find((img) => imageKey(img.name) === key);
}

/** カタログ章の見出し（例: 「F7 随時処理」）。heading があればそれを使う */
export function menuHeading(menu: Menu): string {
  if (menu.heading) {
    return menu.heading;
  }
  // 「在庫メニュー > 随時処理（F7）」「窓口（F1）の業務メニュー」→「F7 随時処理」「F1 窓口」
  const m = /([^>（(]+?)\s*[（(]((?:CTRL\+|SHIFT\+)?F\d+)[）)]/.exec(menu.title);
  if (m) {
    return `${m[2]} ${m[1].trim()}`;
  }
  if (/F\d+/.test(menu.path)) {
    return menu.path.replace(/\s*>\s*/g, " › ");
  }
  return menu.title;
}
