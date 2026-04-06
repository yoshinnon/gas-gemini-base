# gas-gemini-base

> Google Apps Script (GAS) × TypeScript × Gemini API による **マルチモデル対応 AI 開発基盤**

無料枠の制限を考慮し、複数の Gemini モデルを優先順位に従って自動フォールバックする機能を中核に、4つの実用シナリオを実装したモノレポです。

---

## ⚠️ セキュリティに関する重要な警告

> **このリポジトリのツールに以下の情報を絶対に入力しないでください:**
>
> - 銀行・証券会社・取引所の **パスワード・PINコード**
> - 暗号資産ウォレットの **秘密鍵・シードフレーズ（ニーモニック）**
> - クレジットカードの **CVV・カード番号全桁**
> - その他の **認証情報・個人識別番号**
>
> GAS はユーザーの Google アカウントで実行されますが、APIキーや機密情報は必ずスクリプトプロパティで管理し、ソースコードにハードコードしないでください。このリポジトリを fork・公開する際も同様です。

---

## 収録シナリオ

| # | シナリオ | 機能概要 | 詳細 |
|---|---------|---------|------|
| 1 | マルチモデル開発基盤 | Gemini 自動フォールバック・ロギング基盤 | [docs/scenario1-base.md](./docs/scenario1-base.md) |
| 2 | AI議事録解析 | 会議メモからタスクを自動抽出・TaskBoard 出力 | [docs/scenario2-task.md](./docs/scenario2-task.md) |
| 3 | 多通貨ポートフォリオ管理 | 銀行明細・暗号資産を JPY 換算して集計 | [docs/scenario3-asset.md](./docs/scenario3-asset.md) |
| 4 | キッチンサイエンス＆猫在庫管理 | 食材物理特性解析・調理最適化・猫用品在庫 | [docs/scenario4-kitchen.md](./docs/scenario4-kitchen.md) |

---

## 技術スタック

| 項目 | 内容 |
|------|------|
| 言語 | TypeScript (Target: ES2020) |
| ビルド | esbuild（IIFE バンドル → GAS へプッシュ） |
| GAS デプロイ | clasp |
| テスト | Jest + ts-jest |
| AI | Gemini API（複数モデル自動フォールバック） |

### モデル優先順位

| 優先度 | モデル ID |
|--------|-----------|
| 1（最優先）| `gemini-3-flash-preview` |
| 2 | `gemini-2.5-flash` |
| 3 | `gemini-2.5-flash-lite` |

> モデルの追加・変更は `src/infra/AIClient.ts` の `MODEL_PRIORITY` 配列を編集するだけです。

---

## プロジェクト構成

```
gas-gemini-base/
├── docs/                             # 各シナリオの詳細ドキュメント
│   ├── scenario1-base.md
│   ├── scenario2-task.md
│   ├── scenario3-asset.md
│   └── scenario4-kitchen.md
├── src/
│   ├── index.ts                      # GAS グローバル関数エントリポイント
│   ├── infra/                        # インフラ層（全シナリオ共通）
│   │   ├── AIClient.ts               # マルチモデル Gemini クライアント
│   │   ├── Config.ts                 # PropertiesService ラッパー
│   │   ├── Logger.ts                 # スプレッドシートロガー
│   │   └── FinanceApi.ts             # 為替・暗号資産価格取得
│   ├── core/                         # ドメイン・ユースケース層
│   │   ├── TaskExtractor.ts          # タスク抽出ドメイン（シナリオ2）
│   │   ├── TaskUseCase.ts            # タスク抽出ユースケース（シナリオ2）
│   │   ├── AssetParser.ts            # 資産解析ドメイン（シナリオ3）
│   │   ├── AssetUseCase.ts           # 資産解析ユースケース（シナリオ3）
│   │   ├── ScienceParser.ts          # 食材科学パーサー（シナリオ4）
│   │   ├── CookingAdvisor.ts         # 物理計算調理エンジン（シナリオ4）
│   │   ├── CatInventory.ts           # 猫在庫管理（シナリオ4）
│   │   └── KitchenUseCase.ts         # キッチンユースケース（シナリオ4）
│   ├── gas/                          # GAS シート操作アダプター層
│   │   ├── TaskSheetAdapter.ts       # タスクシート操作（シナリオ2）
│   │   ├── AssetRepository.ts        # 資産シート操作（シナリオ3）
│   │   └── KitchenRepository.ts      # キッチンシート操作（シナリオ4）
│   └── presentation/                 # UI・メニュー層
│       ├── index.ts                  # 共通 onOpen・システム診断
│       ├── TaskMenu.ts               # 議事録解析メニュー（シナリオ2）
│       ├── AssetMenu.ts              # 資産管理メニュー（シナリオ3）
│       └── KitchenMenu.ts            # キッチンメニュー（シナリオ4）
├── tests/
│   ├── mocks/gas-globals.ts          # GAS API モック（Jest 用）
│   ├── core/                         # ドメイン層テスト
│   └── infra/                        # インフラ層テスト
├── dist/                             # esbuild ビルド出力（clasp push 対象）
├── .clasp.json.example               # clasp 設定テンプレート
├── .gitignore
├── appsscript.json
├── esbuild.config.js
├── jest.config.js
├── package.json
├── tsconfig.json
└── tsconfig.test.json
```

---

## ゼロからのセットアップ手順

### 前提条件の確認

```bash
node -v   # v18.0.0 以上
npm -v    # v9.0.0 以上
git --version
```

Node.js が未インストールの場合は [nodejs.org](https://nodejs.org/ja/) からインストールしてください。

---

### Step 1: Google アカウントとスプレッドシートの準備

1. [Google アカウント](https://accounts.google.com/signup) でログイン（既存アカウントで可）
2. [Google スプレッドシート](https://sheets.google.com) を開く
3. **「+ 空白」** をクリックして新しいスプレッドシートを作成
4. スプレッドシートに名前を付ける（例: `Gemini AI ツール`）
5. URL から `spreadsheetId` をメモ（後で使用することがあります）
   ```
   https://docs.google.com/spreadsheets/d/【ここがspreadsheetId】/edit
   ```

---

### Step 2: Gemini API キーの取得

1. [Google AI Studio](https://aistudio.google.com/app/apikey) にアクセス
2. 画面左側の **「Get API key」** をクリック
3. **「Create API key」** → プロジェクトを選択（または新規作成）
4. 生成された API キーを安全な場所にコピー

> ⚠️ API キーは他人に見せないでください。ソースコードへのハードコードは厳禁です。

---

### Step 3: リポジトリのセットアップ

```bash
# リポジトリをクローン（GitHub から入手した場合）
git clone https://github.com/YOUR_USERNAME/gas-gemini-base.git
cd gas-gemini-base

# ZIPを解凍した場合はディレクトリに移動
cd gas-gemini-base

# 依存パッケージのインストール
npm install
```

---

### Step 4: clasp のセットアップと Google 認証

clasp は GAS プロジェクトをローカルから管理するための公式 CLI ツールです。

```bash
# clasp をグローバルインストール
npm install -g @google/clasp

# Google アカウントで認証
# → ブラウザが開くので Google アカウントでログインして許可する
npx clasp login

# 認証確認（自分のGASプロジェクト一覧が表示されればOK）
npx clasp list
```

---

### Step 5: GAS プロジェクトの作成と紐付け

#### 方法A: 既存スプレッドシートに紐付ける（推奨）

1. Step 1 のスプレッドシートを開く
2. メニュー **「拡張機能」→「Apps Script」** をクリック
3. GAS エディタが開いたら、ブラウザの URL からスクリプト ID をコピー
   ```
   https://script.google.com/home/projects/【スクリプトID】/edit
   ```
4. プロジェクトに `.clasp.json` を作成:
   ```bash
   cp .clasp.json.example .clasp.json
   ```
5. `.clasp.json` をテキストエディタで開き `scriptId` を書き換える:
   ```json
   {
     "scriptId": "コピーしたスクリプトIDをここに貼り付け",
     "rootDir": "./dist"
   }
   ```

#### 方法B: clasp で新規プロジェクトを作成する

```bash
# 新しいスプレッドシートにバインドされた GAS プロジェクトを作成
npx clasp create --type sheets --title "Gemini AI Base"

# .clasp.json を dist/ ディレクトリに移動（rootDir が dist のため必須）
mv .clasp.json dist/.clasp.json
```

> `.clasp.json` は `.gitignore` に含まれているため Git にはコミットされません。

---

### Step 6: ビルドして GAS へプッシュ

```bash
# TypeScript をコンパイル・バンドルして dist/ に出力
npm run build

# dist/ の内容を GAS プロジェクトへアップロード
npm run push
```

成功すると以下のような出力が表示されます:
```
✅ Build complete: .../dist/bundle.js
└─ dist/bundle.js
└─ dist/appsscript.json
Pushed 2 files.
```

---

### Step 7: Gemini API キーをスクリプトプロパティに設定

**GAS エディタ**（ブラウザ上）で設定します。ソースコードには記録されません。

1. [GAS エディタ](https://script.google.com) を開く（または「拡張機能」→「Apps Script」）
2. 左サイドバーの **「⚙️ プロジェクトの設定」** をクリック
3. **「スクリプトプロパティ」** セクションまでスクロール
4. **「プロパティを追加」** をクリック

| プロパティ名 | 値 | 必須 |
|-------------|-----|:----:|
| `GEMINI_API_KEY` | Step 2 で取得した API キー | ✅ |
| `LOG_SHEET_NAME` | ログシート名（デフォルト: `AI_Log`） | — |

5. **「スクリプトプロパティを保存」** をクリック

---

### Step 8: onOpen トリガーの登録

スプレッドシートを開いたときに **「🤖 Gemini AI」** メニューを自動追加するトリガーを設定します。

1. GAS エディタで左サイドバーの **「⏰ トリガー」** をクリック
2. 右下の **「トリガーを追加」** をクリック
3. 以下のように設定:

| 項目 | 設定値 |
|------|--------|
| 実行する関数 | `onOpen` |
| デプロイ | `Head` |
| イベントのソース | `スプレッドシートから` |
| イベントの種類 | `起動時` |

4. **「保存」** をクリック
5. Google アカウントの権限許可を求めるダイアログが表示されたら **「許可」** を選択

---

### Step 9: 動作確認

1. スプレッドシートを開く（または `F5` で再読み込み）
2. メニューバーに **「🤖 Gemini AI」** が表示されることを確認
3. **「🤖 Gemini AI」→「🔍 システム診断（API接続テスト）」** を実行
4. ✅ 診断完了 - 正常 のダイアログが表示されれば完了！

---

### Step 10: 使いたいシナリオのシートを準備する

手動作成が必要なシートをスプレッドシートに追加してください（下部の「+」ボタンから追加）。

| 使用シナリオ | 手動作成するシート名 | 自動作成されるシート |
|------------|-----------------|-----------------|
| シナリオ2 | `Input` | `TaskBoard`, `AI_Log` |
| シナリオ3 | `AssetInput` | `Portfolio`, `History`, `AI_Log` |
| シナリオ4 | `GroceryInput` | `Inventory`, `CookingDashboard`, `AI_Log` |

> シート名は**大文字・小文字を区別**します。正確に入力してください。

---

## GitHub へのプッシュ

```bash
# 初回のみ: Git 初期化とコミット
git init
git add .
git commit -m "feat: initial commit - gas-gemini-base"

# GitHub でリポジトリを新規作成後
git remote add origin https://github.com/YOUR_USERNAME/gas-gemini-base.git
git branch -M main
git push -u origin main
```

`.clasp.json`（スクリプト ID 含む）は `.gitignore` で除外済みのため、誤って公開されることはありません。

---

## 開発ワークフロー

```bash
npm run build          # TypeScript をビルド
npm run push           # ビルド + GAS へプッシュ
npm run push:force     # 強制プッシュ（競合時）
npm run watch          # ファイル変更を監視して自動ビルド
npm test               # テスト実行
npm run test:coverage  # カバレッジ付きテスト
npm run typecheck      # 型チェックのみ
```

---

## トラブルシューティング

### `clasp push` でエラー / 認証エラー

```bash
npx clasp logout
npx clasp login
```

### `GEMINI_API_KEY が設定されていません` エラー

GAS エディタのスクリプトプロパティを確認してください（Step 7 参照）。プロパティ名のスペルミスに注意。

### `429 Too Many Requests` が全モデルで発生

Gemini API の無料枠（1分あたりのリクエスト数）を超過しています。1〜2分後に再実行してください。`AI_Log` シートでエラー詳細を確認できます。

### `XXX シートが見つかりません` エラー

スプレッドシートに該当シートを手動作成してください。シート名は大文字・小文字を区別します。

### `onOpen` メニューが表示されない

GAS エディタのトリガー設定を確認してください。権限許可が必要な場合があります（Step 8 参照）。

### `clasp push` 後に変更が反映されない

ブラウザキャッシュが原因の場合があります。スプレッドシートを閉じて再度開いてください。

---

## ライセンス

MIT
