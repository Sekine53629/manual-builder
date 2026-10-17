// HTML 文字列を組み立てるときの共通ユーティリティ

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 配列の要素を HTML にして連結する */
export function joinHtml<T>(items: T[], render: (item: T, index: number) => string): string {
  return items.map(render).join("\n");
}
