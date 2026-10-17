// テスト用の小さなカタログと画像
import type { MenuCatalog } from "../src/core/catalog";
import type { ImageAsset, StepsData } from "../src/core/types";

export const SAMPLE_CATALOG: MenuCatalog = {
  menus: [
    {
      id: "m_tabs",
      title: "メインメニュー 上部タブ",
      path: "起動画面",
      items: [
        { ref: "m_tabs:F1", key: "F1", label: "窓口" },
        { ref: "m_tabs:F10", key: "F10", label: "オプション1" },
      ],
    },
    {
      id: "m_ctrl",
      title: "下段ショートカット（CTRL＋Fキー）",
      path: "全タブ共通",
      items: [{ ref: "m_ctrl:CTRL+F1", key: "CTRL+F1", label: "日報印刷" }],
    },
    {
      id: "m_option1",
      title: "オプション1（F10）の業務メニュー",
      path: "メインタブ F10 オプション1",
      items: [{ ref: "m_option1:F1", key: "F1", label: "薬品在庫", opens: "在庫メニュー", pict: "icons/picts/m_option1_F1.png" }],
    },
    {
      id: "m_zaiko_tabs",
      title: "在庫メニュー 上部タブ",
      path: "オプション1 > F1 薬品在庫（別ウィンドウ）",
      items: [{ ref: "m_zaiko_tabs:F7", key: "F7", label: "随時処理" }],
    },
    {
      id: "m_zaiko_zuiji",
      title: "在庫メニュー > 随時処理（F7）",
      path: "在庫メニュー タブF7",
      items: [{ ref: "m_zaiko_zuiji:F1", key: "F1", label: "不動品リスト", pict: "icons/picts/m_zaiko_zuiji_F1.png" }],
    },
    {
      id: "m_ryoshusho",
      title: "伝票入力 > 領収書(F) メニュー",
      path: "伝票入力画面のメニューバー",
      items: [{ ref: "m_ryoshusho:設定", key: "", label: "設定", opens: "印刷設定" }],
    },
  ],
  screens: [
    {
      screen: "伝票入力",
      opened_from: "伝票処理 > F1",
      メニューバー: "ファイル(F)",
      fkeys: [
        { key: "F9", label: "取消" },
        { key: "F12", label: "登録" },
      ],
    },
  ],
};

export const SAMPLE_IMAGES: ImageAsset[] = [{ id: "i1", name: "m_zaiko_zuiji_F1.png", dataUri: "data:image/png;base64,AAAA" }];

export const SAMPLE_STEPS: StepsData = {
  title: "廃棄登録",
  purpose: "破損などで医薬品を廃棄したときの手順。",
  source: "廃棄登録.pdf",
  steps: [
    { text: "在庫メニューを開く", ui: ["m_tabs:F10", "m_option1:F1"] },
    { text: "**F12 登録**を押す", ui: ["s:伝票入力:F12"], images: ["shot1.png"] },
    { text: "完了", ui: [] },
  ],
  cautions: ["期限欄は消してから登録する"],
  notes: "内部メモ（出力しない）",
};
