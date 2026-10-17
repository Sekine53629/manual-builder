// 操作手順（steps JSON）→ HTML。番号付きの手順・チップ・注意書きを組み立てる
import type { StepsData } from "./types";
import { renderChips, type ChipContext } from "./catalog";
import { renderInline, sanitizeHtml } from "./markdown";
import { escapeHtml, joinHtml } from "./html";

export interface StepsRenderResult {
  html: string;
  warnings: string[];
}

/** サブタイトル行。sub があればそれ、無ければ source から作る */
export function stepsSubtitle(data: StepsData): string {
  if (data.sub) {
    return data.sub;
  }
  return data.source ? `原本：${data.source}` : "";
}

export interface StepsRenderOptions {
  /** true: 各手順に data-step="n" を付ける（エディタのスクロール同期用） */
  sourceMap?: boolean;
}

/** 手順番号の属性名 */
export const STEP_ATTR = "data-step";

/** steps JSON を章本文の HTML にする（サニタイズ済み、見出し ID は未付与） */
export function renderStepsHtml(data: StepsData, context: ChipContext, options: StepsRenderOptions = {}): StepsRenderResult {
  try {
    const warnings: string[] = [];
    const parts: string[] = [`<h1>${escapeHtml(data.title)}</h1>`];

    const sub = stepsSubtitle(data);
    if (sub) {
      parts.push(`<p class="sub">${escapeHtml(sub)}</p>`);
    }
    if (data.purpose) {
      parts.push(`<div class="callout use"><b>使う場面：</b>${renderInline(data.purpose)}</div>`);
    }
    if (data.cautions && data.cautions.length > 0) {
      parts.push(
        `<div class="callout caution"><div class="callout-title">注意</div><ul>${joinHtml(
          data.cautions,
          (c) => `<li>${renderInline(c)}</li>`,
        )}</ul></div>`,
      );
    }

    parts.push("<h2>手順</h2>");
    parts.push('<ol class="steps">');
    data.steps.forEach((step, index) => {
      const body: string[] = [`<p class="step-text">${renderInline(step.text)}</p>`];
      if (step.ui && step.ui.length > 0) {
        const chips = renderChips(step.ui, context);
        body.push(chips.html);
        chips.missing.forEach((ref) => warnings.push(`手順 ${index + 1}: 参照 ${ref} がカタログにありません`));
        chips.missingImages.forEach((ref) => warnings.push(`手順 ${index + 1}: ${ref} の絵柄画像が取り込まれていません`));
      }
      for (const image of step.images ?? []) {
        // 実際の差し替え（data URI / インライン SVG）は manual.ts の共通処理で行う
        body.push(`<figure class="shot"><img src="${escapeHtml(image)}" alt=""></figure>`);
      }
      const stepAttr = options.sourceMap ? ` ${STEP_ATTR}="${index + 1}"` : "";
      parts.push(
        `<li class="step"${stepAttr}><span class="step-no">${index + 1}</span><div class="step-body">${body.join("")}</div></li>`,
      );
    });
    parts.push("</ol>");

    return { html: sanitizeHtml(parts.join("\n")), warnings };
  } catch (error) {
    console.error(`[renderStepsHtml] 「${data.title}」の変換に失敗しました:`, error);
    throw error;
  }
}
