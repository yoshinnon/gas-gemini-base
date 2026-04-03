# シナリオ1: マルチモデル対応 Gemini 開発基盤

## 概要

**目的:** 複数の Gemini モデルを自動フォールバックするクライアント基盤を提供し、後続のすべてのシナリオの土台となる共通インフラを構築する。

**用途:**
- 無料枠のレートリミット（429）を透過的に回避したい
- モデルの切り替えをアプリケーションコードに意識させたくない
- 実行ログ（使用モデル・トークン消費量）をスプレッドシートで管理したい

---

## アーキテクチャ

```
スプレッドシートメニュー
        ↓
presentation/index.ts    ← GAS メニュー UI
        ↓
infra/AIClient.ts        ← マルチモデル Gemini クライアント
    ├── infra/Config.ts  ← PropertiesService ラッパー
    └── infra/Logger.ts  ← スプレッドシートロガー
```

---

## 実装ファイル

| ファイル | 役割 |
|---------|------|
| `src/infra/AIClient.ts` | マルチモデルクライアント本体・フォールバック実装 |
| `src/infra/Config.ts` | スクリプトプロパティからの設定値取得 |
| `src/infra/Logger.ts` | 実行ログのスプレッドシート記録 |
| `src/presentation/index.ts` | システム診断・モデル確認メニュー |

---

## 核心機能: 自動フォールバック

```typescript
// src/infra/AIClient.ts より
export const MODEL_PRIORITY: string[] = [
  "gemini-3-flash-preview", // 優先度1: 最高性能
  "gemini-2.5-flash",               // 優先度2: バランス
  "gemini-2.5-flash-lite", // 優先度3: 軽量
];
```

`generateContent()` を呼び出すと、優先度1のモデルから試行し、以下のエラーが発生すると自動的に次のモデルへ切り替わります:

| エラーコード | 意味 | 対処 |
|------------|------|------|
| `429` | Too Many Requests（レートリミット） | 次モデルへフォールバック |
| `503` | Service Unavailable | 次モデルへフォールバック |
| `500` | Internal Server Error | 次モデルへフォールバック |

全モデルが失敗した場合のみ `Error` がスローされます。

---

## スプレッドシートメニュー

スプレッドシートを開くと **「🤖 Gemini AI」** メニューに以下の項目が追加されます:

| メニュー項目 | 機能 |
|------------|------|
| 🛒 購入品をスキャンして在庫更新 | シナリオ4 |
| 🔬 科学的調理アドバイスを表示 | シナリオ4 |
| 🐱 猫の在庫状況を確認 | シナリオ4 |
| 🍝 パスタ乳化ガイド | シナリオ4 |
| 💰 資産データ解析・更新 | シナリオ3 |
| 📊 ポートフォリオ状況を確認 | シナリオ3 |
| 📝 AI議事録解析を実行 | シナリオ2 |
| 📋 TaskBoard の状況を確認 | シナリオ2 |
| 🔍 システム診断（API接続テスト）| シナリオ1 |
| 📊 アクティブモデルを確認 | シナリオ1 |
| 🗒️ ログシートを開く | シナリオ1 |
| ⚙️ APIキーを設定する | シナリオ1 |

---

## ログシート（AI_Log）

API 呼び出しのたびに自動でログが記録されます。

| 列名 | 内容 |
|------|------|
| タイムスタンプ | ISO 8601 形式の実行日時 |
| モデル名 | 実際に使用されたモデル |
| プロンプトトークン | 入力トークン数 |
| レスポンストークン | 出力トークン数 |
| 合計トークン | 消費トークン総数 |
| ステータス | SUCCESS / FALLBACK / ERROR |
| メッセージ | 詳細情報 |

フォールバックが発生した場合は `FALLBACK` ステータスで「→ 次モデル名 へフォールバック: 理由」が記録されます。

---

## 使い方（コードから利用する場合）

```typescript
import { AIClient } from "./infra/AIClient";

// デフォルト（MODEL_PRIORITY の順序でフォールバック）
const client = new AIClient();
const result = client.generateContent(
  "あなたのプロンプト",
  "システムプロンプト（省略可）",
  { temperature: 0.7, maxOutputTokens: 1000 } // 生成設定（省略可）
);

console.log(result.text);         // 生成テキスト
console.log(result.modelUsed);    // 実際に使用されたモデル名
console.log(result.fallbackCount); // フォールバック回数（0=フォールバックなし）
console.log(result.usageMetadata); // トークン消費量
```

```typescript
// カスタムモデルリストを指定する場合
const client = new AIClient(["gemini-2.5-flash", "gemini-2.5-flash-lite"]);
```

---

## テスト

```bash
# インフラ層のテストのみ実行
npx jest tests/infra/

# 特定のテストファイル
npx jest tests/infra/AIClient.test.ts
```

テストでは GAS グローバル API（`UrlFetchApp`, `PropertiesService` など）を `tests/mocks/gas-globals.ts` でモックしています。ローカルの Node.js 環境で実行できます。

---

## モデルの追加・変更方法

`src/infra/AIClient.ts` の `MODEL_PRIORITY` 配列を編集するだけです:

```typescript
export const MODEL_PRIORITY: string[] = [
  "gemini-3-flash-preview",  // 必要に応じて追加
  "gemini-3-flash-preview",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];
```

切り替えロジックはこの配列を参照するため、他のコードを変更する必要はありません。
