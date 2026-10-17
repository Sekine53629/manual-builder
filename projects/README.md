# projects/

Manual Builder の「保存フォルダ」です。アプリで「保存フォルダを開く」からこのフォルダを選ぶと、
サブフォルダがプロジェクトとして一覧に出ます。

```
projects/
├── sample/                 ← 動作確認用（Git 管理）
│   ├── manual.json         ← マニュアル情報・章の並び・グループ（CLI の manifest と同じ形式）
│   ├── chapters/           ← 原稿（.md）と手順（.json）
│   ├── images/             ← 絵柄・画面（.png）と図（.svg）。ファイル名で参照する
│   ├── catalog/            ← menus.json（メニュー定義）と menu-tree.txt（ツリー表示）
│   └── output/             ← 書き出した HTML（Git 管理外）
└── <自分のプロジェクト>/      ← Git 管理外（店舗の内部資料・個人名を含むため）
```

- `sample/` 以外のプロジェクトは `.gitignore` で除外されています。別途バックアップしてください
- 原稿を手元のエディタで直接編集しても構いません。アプリ側は「再読込」で読み直します
- CLI でも同じフォルダから生成できます: `node .cli/build-cli.js projects/<名前>/manual.json`
