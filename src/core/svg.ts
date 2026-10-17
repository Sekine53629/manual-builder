// SVG ファイルの取り込み（サニタイズ・インライン化の準備）
import { type Config } from "dompurify";
import { purifier } from "./markdown";
import { imageKey } from "./catalog";

const SVG_SANITIZE_OPTIONS: Config = {
  USE_PROFILES: { svg: true, svgFilters: true },
  ADD_TAGS: ["use"],
  ADD_ATTR: ["xlink:href", "href", "xmlns", "xmlns:xlink", "viewBox", "preserveAspectRatio"],
};

/** SVG ファイルの中身を、HTML に直接埋め込める安全な文字列にする */
export function sanitizeSvg(svgText: string, sourceName: string): string {
  try {
    const clean = purifier().sanitize(svgText, SVG_SANITIZE_OPTIONS).trim();
    if (!/^<svg[\s>]/i.test(clean)) {
      throw new Error("ルート要素が <svg> ではありません");
    }
    if (!/\sviewBox=/i.test(clean)) {
      console.warn(`[sanitizeSvg] ${sourceName}: viewBox がないため拡大縮小が崩れることがあります`);
    }
    return clean;
  } catch (error) {
    console.error(`[sanitizeSvg] ${sourceName} の取り込みに失敗しました:`, error);
    throw error;
  }
}

/** パスや URL から参照キー（ファイル名のみ・小文字）を取り出す */
export function figureKey(pathOrName: string): string {
  return imageKey(pathOrName);
}
