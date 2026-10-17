import { describe, expect, it } from "vitest";
import { imageKey, isMenuCatalog, menuHeading, parseChipRefs, renderChips, resolveRef } from "../src/core/catalog";
import { renderCatalogHtml } from "../src/core/catalog-page";
import { createEmptyManual } from "../src/core/types";
import { SAMPLE_CATALOG, SAMPLE_IMAGES } from "./fixtures";

describe("resolveRef", () => {
  it("メニュー項目を ref で引く", () => {
    const r = resolveRef("m_zaiko_zuiji:F1", SAMPLE_CATALOG);
    expect(r.kind).toBe("menu");
    if (r.kind === "menu") {
      expect(r.item.label).toBe("不動品リスト");
    }
  });

  it("画面のファンクションキーを s:画面:キー で引く（画面名にコロン以外の記号があってもよい）", () => {
    const r = resolveRef(" s:伝票入力:F12 ", SAMPLE_CATALOG);
    expect(r.kind).toBe("screen");
    if (r.kind === "screen") {
      expect(r.fkey.label).toBe("登録");
    }
  });

  it("無い参照・カタログ無しは missing", () => {
    expect(resolveRef("m_tabs:F99", SAMPLE_CATALOG).kind).toBe("missing");
    expect(resolveRef("s:無い画面:F1", SAMPLE_CATALOG).kind).toBe("missing");
    expect(resolveRef("m_tabs:F1", undefined).kind).toBe("missing");
  });
});

describe("renderChips", () => {
  it("種類ごとのクラスとキーバッジを出力し、› でつなぐ", () => {
    const { html, missing, missingImages } = renderChips(
      ["m_tabs:F10", "m_option1:F1", "m_zaiko_tabs:F7", "m_zaiko_zuiji:F1", "m_ctrl:CTRL+F1", "m_ryoshusho:設定", "s:伝票入力:F12"],
      { catalog: SAMPLE_CATALOG, images: SAMPLE_IMAGES },
    );
    expect(html.startsWith('<div class="chips">')).toBe(true);
    expect(html.split('<span class="arrow">›</span>')).toHaveLength(7);
    expect(html).toContain('<span class="chip tab"><span class="k">F10</span>オプション1</span>');
    // 絵柄画像が無い項目はキーとラベルのみ
    expect(html).toContain('<span class="chip"><span class="k">F1</span>薬品在庫</span>');
    expect(html).toContain('<span class="chip ztab"><span class="k">F7</span>随時処理</span>');
    expect(html).toContain('<span class="chip"><img src="data:image/png;base64,AAAA" alt=""><span class="k">F1</span>不動品リスト</span>');
    expect(html).toContain('<span class="chip key"><span class="k">CTRL+F1</span>日報印刷</span>');
    expect(html).toContain('<span class="chip plain">設定</span>');
    expect(html).toContain('<span class="chip key" title="伝票入力"><span class="k">F12</span>登録</span>');
    expect(missing).toEqual([]);
    expect(missingImages).toEqual(["m_option1:F1"]);
  });

  it("ラベルの HTML をエスケープする", () => {
    const catalog = { menus: [{ id: "m", title: "t", path: "p", items: [{ ref: "m:F1", key: "F1", label: "<b>x</b>" }] }], screens: [] };
    expect(renderChips(["m:F1"], { catalog, images: [] }).html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});

describe("helpers", () => {
  it("parseChipRefs は空白を除いて分割する", () => {
    expect(parseChipRefs(" a:F1 , b:F2,, s:画面 名:F3 ")).toEqual(["a:F1", "b:F2", "s:画面 名:F3"]);
  });

  it("imageKey はパスを捨てて小文字にする", () => {
    expect(imageKey("icons/picts/M_Zaiko_F1.PNG")).toBe("m_zaiko_f1.png");
  });

  it("isMenuCatalog は menus と screens を持つものだけ真", () => {
    expect(isMenuCatalog(SAMPLE_CATALOG)).toBe(true);
    expect(isMenuCatalog({ title: "x", steps: [] })).toBe(false);
  });

  it("menuHeading は「F7 随時処理」の形にする（heading 指定が最優先）", () => {
    expect(menuHeading(SAMPLE_CATALOG.menus[4])).toBe("F7 随時処理");
    expect(menuHeading(SAMPLE_CATALOG.menus[2])).toBe("F10 オプション1");
    expect(menuHeading({ id: "x", title: "集計２", path: "集計 > F12 集計２", items: [] })).toBe("集計 › F12 集計２");
    expect(menuHeading({ id: "x", title: "集計２", path: "集計 > F12 集計２", heading: "F5 集計 › F12 集計２", items: [] })).toBe("F5 集計 › F12 集計２");
  });
});

describe("renderCatalogHtml", () => {
  it("カタログが無ければ不足表示と警告", () => {
    const manual = createEmptyManual("m");
    const { html, warnings } = renderCatalogHtml(manual);
    expect(html).toContain("manual-figure-missing");
    expect(warnings).toHaveLength(1);
  });

  it("ツリー・タブ・グリッド・画面別キーの各節を出力する", () => {
    const manual = createEmptyManual("m");
    manual.catalog = { ...SAMPLE_CATALOG, meta: { title: "エリシアS メニュー構成", pending: ["F2 の中身"] } };
    manual.images = SAMPLE_IMAGES;
    manual.menuTree = "root\n├─ F1 窓口\n";
    const { html, warnings } = renderCatalogHtml(manual);
    expect(html).toContain("<h1>エリシアS メニュー構成</h1>");
    expect(html).toContain("<h2>1. メニュー構成（ディレクトリ表示）</h2>");
    expect(html).toContain('<pre class="tree">root\n├─ F1 窓口</pre>');
    expect(html).toContain("<h2>2. メインメニュー</h2>");
    expect(html).toContain("<h2>3. 在庫メニュー（オプション1 › F1 薬品在庫）</h2>");
    expect(html).toContain("<h2>4. 画面別ファンクションキー</h2>");
    expect(html).toContain("<h2>5. まだ取得できていない部分</h2>");
    expect(html).toContain("<li>F2 の中身</li>");
    // 上部タブの並び
    expect(html).toContain('<div class="chips tabs"><span class="chip tab"><span class="k">F1</span>窓口</span><span class="chip tab"><span class="k">F10</span>オプション1</span></div>');
    // 12 マスのグリッド（空きは dashed）
    expect(html).toContain("<h3>F7 随時処理</h3>");
    expect(html).toContain('<div class="cell"><img class="pict" src="data:image/png;base64,AAAA" alt=""><span class="k">F1</span><span class="lbl">不動品リスト</span></div>');
    expect(html).toContain('<div class="cell empty"><span class="k">F2</span><span class="lbl">—</span></div>');
    expect(html).toContain('<span class="lbl">薬品在庫<span class="opens">→ 在庫メニュー</span></span>');
    // CTRL メニューは 6 列のキーセル、キー無しメニューは 1 行
    expect(html).toContain('<div class="fcell"><span class="fk">CTRL+F1</span><span class="fl">日報印刷</span></div>');
    expect(html).toContain("<p>設定（印刷設定）</p>");
    // 画面別キー
    expect(html).toContain("<h3>伝票入力</h3>");
    expect(html).toContain('<div class="meta">開き方：伝票処理 &gt; F1</div>');
    expect(html).toContain('<div class="meta">メニューバー：ファイル(F)</div>');
    expect(html).toContain('<div class="fcell"><span class="fk">F12</span><span class="fl">登録</span></div>');
    expect(html).toContain('<div class="fcell empty"><span class="fk">F1</span><span class="fl">—</span></div>');
    expect(warnings).toEqual(["カタログ章: m_option1:F1 の絵柄画像（icons/picts/m_option1_F1.png）が取り込まれていません"]);
  });
});
