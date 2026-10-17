// 本文中の図（SVG / PNG）の配置。Markdown の画像記法の直後に `{w=80 mt=6 ml=10 p=3 align=left}` と書く。
//   w     幅（mm。`50%` のように % も可）
//   mt    上の余白（mm） = 直前の要素からの距離
//   mb    下の余白（mm）
//   ml    左の位置（mm。align=left のときの左端からの距離）
//   p     内側の余白（mm）
//   align left / center / right（既定 center）
//
// marked は `{...}` を解釈しないので、変換前に画像 URL のハッシュ（`#mb:w=80;mt=6`）へ移し、
// 変換後に figure 要素の style に反映する。

export interface FigureLayout {
  w?: string;
  mt?: number;
  mb?: number;
  ml?: number;
  p?: number;
  align?: "left" | "center" | "right";
}

/** 画像 URL のハッシュに属性を載せるときの接頭辞 */
export const FIGURE_ATTR_PREFIX = "mb:";

const IMAGE_WITH_ATTRS = /!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)\{([^}\n]*)\}/g;
const NUMBER_KEYS = ["mt", "mb", "ml", "p"] as const;

export function parseFigureAttrs(text: string): FigureLayout {
  const layout: FigureLayout = {};
  for (const token of text.split(/[\s;,]+/)) {
    const m = /^(\w+)\s*=\s*(.+)$/.exec(token.trim());
    if (!m) {
      continue;
    }
    const [, key, raw] = m;
    const value = raw.trim();
    if (key === "w") {
      if (/^\d+(\.\d+)?(%|mm)?$/.test(value)) {
        layout.w = value.endsWith("%") || value.endsWith("mm") ? value : `${value}mm`;
      }
    } else if (key === "align") {
      if (value === "left" || value === "center" || value === "right") {
        layout.align = value;
      }
    } else if ((NUMBER_KEYS as readonly string[]).includes(key)) {
      const n = Number(value.replace(/mm$/, ""));
      if (Number.isFinite(n)) {
        layout[key as (typeof NUMBER_KEYS)[number]] = Math.round(n * 2) / 2;
      }
    }
  }
  return layout;
}

/** 属性を `w=80 mt=6` の形に戻す。既定値（未設定）は省く */
export function serializeFigureAttrs(layout: FigureLayout): string {
  const parts: string[] = [];
  if (layout.w) {
    parts.push(`w=${layout.w.replace(/mm$/, "")}`);
  }
  for (const key of NUMBER_KEYS) {
    const v = layout[key];
    if (v !== undefined && v !== 0) {
      parts.push(`${key}=${Number(v.toFixed(1))}`);
    }
  }
  if (layout.align && layout.align !== "center") {
    parts.push(`align=${layout.align}`);
  }
  return parts.join(" ");
}

/** `![alt](src){attrs}` → `![alt](src#mb:attrs)`。フェンスコードの中は触らない */
export function moveImageAttrsToHash(markdown: string): string {
  const lines = markdown.split("\n");
  let inFence = false;
  return lines
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) {
        return line;
      }
      return line.replace(IMAGE_WITH_ATTRS, (_m, alt: string, src: string, title: string | undefined, attrs: string) => {
        const serialized = serializeFigureAttrs(parseFigureAttrs(attrs));
        if (!serialized) {
          return `![${alt}](${src}${title ?? ""})`;
        }
        const encoded = encodeURIComponent(serialized.replace(/ /g, ";"));
        return `![${alt}](${src}#${FIGURE_ATTR_PREFIX}${encoded}${title ?? ""})`;
      });
    })
    .join("\n");
}

/** img の src からパス部分と配置属性を分ける */
export function splitFigureSrc(src: string): { path: string; layout: FigureLayout } {
  const hashIndex = src.indexOf("#");
  if (hashIndex < 0) {
    return { path: src, layout: {} };
  }
  const path = src.slice(0, hashIndex);
  const hash = src.slice(hashIndex + 1);
  if (!hash.startsWith(FIGURE_ATTR_PREFIX)) {
    return { path, layout: {} };
  }
  let body = hash.slice(FIGURE_ATTR_PREFIX.length);
  try {
    body = decodeURIComponent(body);
  } catch {
    // エンコードされていない値はそのまま
  }
  return { path, layout: parseFigureAttrs(body.replace(/;/g, " ")) };
}

/** figure 要素に付ける inline style */
export function figureStyle(layout: FigureLayout): string {
  const parts: string[] = [];
  if (layout.w) {
    parts.push(`width:${layout.w}`);
  }
  if (layout.mt !== undefined) {
    parts.push(`margin-top:${layout.mt}mm`);
  }
  if (layout.mb !== undefined) {
    parts.push(`margin-bottom:${layout.mb}mm`);
  }
  if (layout.p !== undefined) {
    parts.push(`padding:${layout.p}mm`);
  }
  const align = layout.align ?? "center";
  if (align === "left") {
    parts.push(`margin-left:${layout.ml ?? 0}mm`, "margin-right:auto");
  } else if (align === "right") {
    parts.push("margin-left:auto", "margin-right:0");
  } else if (layout.w) {
    parts.push("margin-left:auto", "margin-right:auto");
  }
  return parts.join(";");
}

/**
 * Markdown の 1 行の中で、src（ファイル名で照合）が一致する画像記法の `{...}` を置き換える。
 * 属性が空なら `{...}` を外す。一致する画像が無ければ元の行を返す
 */
export function rewriteImageAttrs(line: string, srcKey: string, layout: FigureLayout): string {
  const pattern = /!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)(\{[^}\n]*\})?/g;
  const serialized = serializeFigureAttrs(layout);
  let replaced = false;
  const out = line.replace(pattern, (m, alt: string, src: string, title: string | undefined) => {
    if (replaced) {
      return m;
    }
    const base = (src.split(/[?#]/)[0].split(/[\\/]/).pop() ?? "").toLowerCase();
    if (base !== srcKey.toLowerCase()) {
      return m;
    }
    replaced = true;
    return `![${alt}](${src}${title ?? ""})${serialized ? `{${serialized}}` : ""}`;
  });
  return out;
}
