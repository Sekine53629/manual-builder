// メニュー定義（catalog JSON）→「メニュー構成とアイコン一覧」章の HTML
import type { Manual } from "./types";
import {
  MAIN_TAB_MENU_ID,
  SUB_TAB_MENU_ID,
  findImage,
  menuHeading,
  renderChip,
  type ChipContext,
  type Menu,
  type MenuCatalog,
  type MenuItem,
  type Screen,
} from "./catalog";
import { sanitizeHtml } from "./markdown";
import { escapeHtml, joinHtml } from "./html";

export const DEFAULT_CATALOG_TITLE = "メニュー構成とアイコン一覧";

/** 標準で並べるファンクションキー */
const FUNCTION_KEYS = Array.from({ length: 12 }, (_, i) => `F${i + 1}`);
const SCREEN_RESERVED_KEYS = new Set(["screen", "opened_from", "fkeys"]);

export interface CatalogRenderResult {
  html: string;
  warnings: string[];
}

/** カタログ章の HTML（サニタイズ済み、見出し ID は未付与） */
export function renderCatalogHtml(manual: Manual, titleOverride?: string): CatalogRenderResult {
  try {
    const catalog = manual.catalog;
    const title = titleOverride?.trim() || catalog?.meta?.title || DEFAULT_CATALOG_TITLE;
    if (!catalog) {
      return {
        html: `<h1>${escapeHtml(title)}</h1><div class="manual-figure-missing">[メニュー定義（catalog JSON）が取り込まれていません]</div>`,
        warnings: ["カタログ章: メニュー定義（catalog JSON）が取り込まれていません"],
      };
    }
    const context: ChipContext = { catalog, images: manual.images };
    const warnings: string[] = [];
    const parts: string[] = [`<h1>${escapeHtml(title)}</h1>`];
    if (catalog.meta?.sub) {
      parts.push(`<p class="sub">${escapeHtml(catalog.meta.sub)}</p>`);
    }
    if (catalog.meta?.intro) {
      parts.push(`<p>${escapeHtml(catalog.meta.intro)}</p>`);
    }
    parts.push(renderLegend(catalog, context));

    let section = 0;
    if (manual.menuTree) {
      section += 1;
      parts.push(`<h2>${section}. メニュー構成（ディレクトリ表示）</h2>`);
      parts.push(`<pre class="tree">${escapeHtml(manual.menuTree.trim())}</pre>`);
    }

    // タブメニューごとに節を切る。CTRL+F などの修飾キーだけのメニューは節の最後に回す（参考 PDF と同じ並び）
    let deferred: Menu[] = [];
    const flushDeferred = () => {
      deferred.forEach((m) => parts.push(renderMenu(m, manual, warnings)));
      deferred = [];
    };
    for (const menu of catalog.menus) {
      if (menu.id === MAIN_TAB_MENU_ID || menu.id === SUB_TAB_MENU_ID) {
        flushDeferred();
        section += 1;
        parts.push(`<h2>${section}. ${escapeHtml(sectionHeading(menu))}</h2>`);
        if (menu.intro) {
          parts.push(`<p>${escapeHtml(menu.intro)}</p>`);
        }
        parts.push("<h3>上部タブ</h3>");
        parts.push(`<div class="chips tabs">${menu.items.map((i) => renderChip(i.ref, context).html).join("")}</div>`);
        continue;
      }
      if (isModifierOnlyMenu(menu)) {
        deferred.push(menu);
      } else {
        parts.push(renderMenu(menu, manual, warnings));
      }
    }
    flushDeferred();

    if (catalog.screens.length > 0) {
      section += 1;
      parts.push(`<h2>${section}. 画面別ファンクションキー</h2>`);
      parts.push(joinHtml(catalog.screens, renderScreen));
    }

    if (catalog.meta?.pending && catalog.meta.pending.length > 0) {
      section += 1;
      parts.push(`<h2>${section}. まだ取得できていない部分</h2>`);
      parts.push(`<ul>${joinHtml(catalog.meta.pending, (p) => `<li>${escapeHtml(p)}</li>`)}</ul>`);
      if (catalog.meta.pendingNote) {
        parts.push(`<p>${escapeHtml(catalog.meta.pendingNote)}</p>`);
      }
    }

    return { html: sanitizeHtml(parts.join("\n")), warnings };
  } catch (error) {
    console.error("[renderCatalogHtml] カタログ章の変換に失敗しました:", error);
    throw error;
  }
}

/** 「メインメニュー 上部タブ」→「メインメニュー」、path に階層があれば「（オプション1 › F1 薬品在庫）」を添える */
function sectionHeading(menu: Menu): string {
  const base = menu.title.replace(/\s*上部タブ\s*$/, "");
  if (menu.path.includes(">")) {
    const path = menu.path.replace(/（[^）]*）\s*$/, "").replace(/\s*>\s*/g, " › ");
    return `${base}（${path}）`;
  }
  return base;
}

function renderLegend(catalog: MenuCatalog, context: ChipContext): string {
  const chips: string[] = [];
  const mainTab = catalog.menus.find((m) => m.id === MAIN_TAB_MENU_ID)?.items[0];
  if (mainTab) {
    chips.push(`<span class="chip tab"><span class="k">${escapeHtml(mainTab.key)}</span>メインタブ</span>`);
  }
  const pictItem = catalog.menus.flatMap((m) => m.items).find((i) => i.pict && findImage(i.pict, context.images));
  if (pictItem) {
    chips.push(renderChip(pictItem.ref, context).html);
  }
  const subTab = catalog.menus.find((m) => m.id === SUB_TAB_MENU_ID);
  if (subTab && subTab.items[0]) {
    const label = subTab.title.replace(/\s*上部タブ\s*$/, "");
    chips.push(`<span class="chip ztab"><span class="k">${escapeHtml(subTab.items[0].key)}</span>${escapeHtml(label)}のタブ</span>`);
  }
  if (catalog.screens.length > 0) {
    chips.push('<span class="chip key"><span class="k">F12</span>画面のファンクションキー</span>');
  }
  return chips.length > 0 ? `<div class="chips legend"><span class="legend-label">凡例：</span>${chips.join("")}</div>` : "";
}

function renderMenu(menu: Menu, manual: Manual, warnings: string[]): string {
  const heading = `<h3>${escapeHtml(menuHeading(menu))}</h3>`;
  const hasKeys = menu.items.some((i) => i.key);
  if (!hasKeys) {
    // キーの無いメニュー（メニューバーの項目など）は 1 行で列挙する
    const labels = menu.items.map((i) => (i.opens ? `${i.label}（${i.opens}）` : i.label)).join("／");
    return `${heading}<p>${escapeHtml(labels)}</p>`;
  }
  if (isModifierOnlyMenu(menu)) {
    return `${heading}<div class="grid6">${joinHtml(menu.items, (i) => keyCell(i.key, i.label))}</div>`;
  }
  // F1〜F12 の 12 マスだけを並べる（SHIFT+F12 などの別キーはチップ参照には使えるが一覧には出さない）
  const byKey = new Map(menu.items.map((i) => [i.key, i]));
  const cells = FUNCTION_KEYS.map((key) => iconCell(key, byKey.get(key), manual, warnings));
  return `${heading}<div class="grid3">${cells.join("\n")}</div>`;
}

/** 全項目が CTRL+F1 のような修飾キー付きのメニューか */
function isModifierOnlyMenu(menu: Menu): boolean {
  return menu.items.length > 0 && menu.items.every((i) => /^(CTRL|SHIFT|ALT)\+/i.test(i.key));
}

function iconCell(key: string, item: MenuItem | undefined, manual: Manual, warnings: string[]): string {
  if (!item) {
    return `<div class="cell empty"><span class="k">${escapeHtml(key)}</span><span class="lbl">—</span></div>`;
  }
  let img = "";
  if (item.pict) {
    const asset = findImage(item.pict, manual.images);
    if (asset) {
      img = `<img class="pict" src="${asset.dataUri}" alt="">`;
    } else {
      warnings.push(`カタログ章: ${item.ref} の絵柄画像（${item.pict}）が取り込まれていません`);
    }
  }
  const opens = item.opens ? `<span class="opens">→ ${escapeHtml(item.opens)}</span>` : "";
  return `<div class="cell">${img}<span class="k">${escapeHtml(item.key)}</span><span class="lbl">${escapeHtml(item.label)}${opens}</span></div>`;
}

function keyCell(key: string, label: string | undefined): string {
  const cls = label ? "fcell" : "fcell empty";
  return `<div class="${cls}"><span class="fk">${escapeHtml(key)}</span><span class="fl">${label ? escapeHtml(label) : "—"}</span></div>`;
}

function renderScreen(screen: Screen): string {
  const parts: string[] = [`<h3>${escapeHtml(screen.screen)}</h3>`];
  if (screen.opened_from) {
    parts.push(`<div class="meta">開き方：${escapeHtml(screen.opened_from)}</div>`);
  }
  for (const [key, value] of Object.entries(screen)) {
    if (!SCREEN_RESERVED_KEYS.has(key) && typeof value === "string" && value) {
      parts.push(`<div class="meta">${escapeHtml(key)}：${escapeHtml(value)}</div>`);
    }
  }
  const byKey = new Map(screen.fkeys.map((k) => [k.key, k.label]));
  const cells = FUNCTION_KEYS.map((key) => keyCell(key, byKey.get(key)));
  screen.fkeys.filter((k) => !FUNCTION_KEYS.includes(k.key)).forEach((k) => cells.push(keyCell(k.key, k.label)));
  parts.push(`<div class="grid6">${cells.join("\n")}</div>`);
  return parts.join("\n");
}
