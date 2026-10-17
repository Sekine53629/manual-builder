---
title: 操作経路チップと生 HTML のサンプル
subtitle: 出典：Manual Builder サンプル｜2026-10-17 作成｜front matter の title が章タイトル、subtitle がこの行になります
---

## 操作経路（チップ）

`[[chips:...]]` だけの行は、メニュー定義（`menus.json`）の参照名からボタンの並びに置き換わります。

[[chips:m_tabs:F1, m_sample:F1, s:患者登録:F12]]

在庫メニューのタブは色が変わり、CTRL＋F キーやメニューバー項目はキー表示になります。

[[chips:m_zaiko_tabs:F3, m_zaiko_denpyo:F1, m_ctrl:CTRL+F1]]

登録されていない参照は赤枠で表示され、メッセージ欄にも記録されます。

[[chips:m_tabs:F1, m_none:F9]]

## 生 HTML のフロー図

<div class="flow">
<div class="fbox s">① 受付<br><small>保険証・資格確認書を確認</small></div>
<div class="arr">▼</div>
<div class="row">
<div class="fbox g">登録済み<br><small>処方入力へ</small></div>
<div class="fbox o">未登録<br><small>患者登録へ</small></div>
</div>
</div>

<div class="meta">出典：サンプル（見出しの直下に置く出典行）</div>

1. **太字は「約物」の直後でも**効きます
2. 行末で改行すると
   そのまま改行として表示されます

> **注意：** 引用は注意書き（黄色の囲み）になります。

<div class="todo">要確認：未整備の箇所はこの枠で示します。</div>
