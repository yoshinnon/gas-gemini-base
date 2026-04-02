/**
 * @file src/core/AssetParser.ts
 * @description 雑多なテキストから資産情報を抽出するドメインモデルとプロンプト設計。
 *
 * 設計方針:
 * - AssetItem はインフラ非依存の純粋なドメインオブジェクト
 * - 特定銀行・取引所に依存しない汎用パーサー（GitHub公開想定）
 * - System Instruction で JSON スキーマを厳密強制し、通貨コードを標準化
 */

// ===========================
// ドメインモデル
// ===========================

/** 資産カテゴリー */
export type AssetCategory =
  | "Cash"       // 現金・預金（銀行口座残高など）
  | "Stock"      // 株式（国内・海外）
  | "Crypto"     // 暗号資産（BTC, ETH など）
  | "Fund"       // 投資信託・ETF
  | "Bond"       // 債券
  | "FX"         // 外貨預金・FX
  | "RealEstate" // 不動産（評価額）
  | "Other";     // その他

/** 標準化された通貨コード（ISO 4217 + 暗号資産） */
export type CurrencyCode =
  | "JPY" | "USD" | "EUR" | "GBP" | "AUD" | "CAD" | "CHF" | "CNY" | "HKD"
  | "SGD" | "KRW" | "TWD" | "THB" | "MXN" | "BRL" | "INR"
  | "BTC" | "ETH" | "SOL" | "XRP" | "USDT" | "USDC" | "BNB" | "ADA"
  | "UNKNOWN";

/** 資産1件を表すドメインオブジェクト */
export interface AssetItem {
  /** 資産名（例: "三菱UFJ銀行 普通預金", "Bitcoin", "トヨタ自動車"） */
  assetName: string;
  /** 数量・残高（正の数値） */
  amount: number;
  /** 標準化された通貨コード */
  currency: CurrencyCode;
  /** 資産カテゴリー */
  category: AssetCategory;
  /**
   * 元テキストから推測した口座・銘柄の識別子。
   * 差分更新ロジックの照合キーとして使用する。
   * 例: "mufg_futsuu_001", "btc_wallet_main"
   */
  identifier: string;
  /** 元テキストから抽出した生の数値文字列（デバッグ用） */
  rawAmountText: string;
}

/** AI からのレスポンス全体 */
export interface AssetExtractionResult {
  assets: AssetItem[];
  /** 入力テキストのサマリー（どんなデータが含まれていたか） */
  sourceSummary: string;
  /** 解析の注意点・不確かな点 */
  warnings: string[];
}

// ===========================
// JSON スキーマ（プロンプト埋め込み用）
// ===========================

const JSON_SCHEMA = `
{
  "assets": [
    {
      "assetName": "string — 資産の正式名称または一般的な名称（例: 三菱UFJ銀行 普通預金、Bitcoin）",
      "amount": "number — 純粋な数値のみ（カンマ・通貨記号を除く正の数）",
      "currency": "string — ISO 4217 通貨コードまたは暗号資産ティッカー（JPY/USD/EUR/BTC/ETH/SOL/XRP/USDT/USDC/BNB/ADA/UNKNOWN）",
      "category": "string — Cash / Stock / Crypto / Fund / Bond / FX / RealEstate / Other のいずれか",
      "identifier": "string — 資産を一意に識別するスネークケースのキー（例: mufg_futsuu, btc_main, toyota_stock）",
      "rawAmountText": "string — テキストから抽出した元の数値文字列（例: ¥1,234,567、0.0523 BTC）"
    }
  ],
  "sourceSummary": "string — 入力テキストの概要（どんな金融機関・資産クラスのデータか）",
  "warnings": ["string — 解析上の注意点・不確実な箇所（配列、なければ空配列 []）"]
}
`.trim();

// ===========================
// プロンプト生成
// ===========================

/**
 * 資産抽出用システムプロンプトを生成する。
 */
export function buildAssetSystemPrompt(): string {
  return `
あなたは多通貨・多資産対応の金融データ解析AIです。
銀行明細、証券口座、暗号資産ウォレット、家計簿アプリなど、様々な金融サービスのテキストから資産情報を抽出します。

## 出力形式（厳守）
- 必ず以下の JSON スキーマのみを出力すること。
- JSON 以外の文章・説明・Markdown コードブロック（\`\`\`）は一切含めないこと。

${JSON_SCHEMA}

## 抽出ルール

### 1. 抽出対象
以下の情報が含まれていれば必ず抽出すること:
- 銀行口座の残高（普通預金、定期預金、外貨預金）
- 証券口座の株式・投資信託・ETFの評価額または保有数量
- 暗号資産の保有数量または評価額
- クレジットカードのポイント残高（1ポイント=1円として換算、category: Cash）
- 電子マネー残高（Suica, PayPay 等、category: Cash）

### 2. 無視すべき情報
- 広告・バナーテキスト
- ログイン画面のUI要素（「パスワード」「ログイン」ボタンのラベル等）
- 取引履歴の個別明細（残高または評価額のみを抽出する）
- 未確定・予定の金額（「予定」「見込み」が付くもの）

### 3. 通貨の識別と標準化
| 元の表記 | 変換後 |
|---------|--------|
| ¥, 円, JPY | JPY |
| $, USD, ドル | USD |
| €, EUR, ユーロ | EUR |
| £, GBP | GBP |
| BTC, ビットコイン | BTC |
| ETH, イーサリアム | ETH |
| SOL, ソラナ | SOL |
| XRP, リップル | XRP |
| 認識できない通貨 | UNKNOWN |

### 4. カテゴリーの判定
- **Cash**: 銀行預金、電子マネー、ポイント、現金
- **Stock**: 株式（国内・米国・その他外国株）
- **Crypto**: BTC, ETH, SOL, XRP, USDT, USDC, BNB, ADA その他暗号資産
- **Fund**: 投資信託、ETF（上場投資信託）、NISA口座内のファンド
- **Bond**: 国債、社債、外国債券
- **FX**: FXポジション、外貨預金（外貨建て）
- **RealEstate**: 不動産評価額
- **Other**: 上記に当てはまらないもの

### 5. identifier の生成規則
- スネークケース（小文字・アンダースコア）
- 銀行名+口座種別、または資産名の略称
- 同じ資産が複数あれば末尾に _2, _3 を付与
- 例: mufg_futsuu, smbc_teiki, btc_wallet_1, toyota_stock, sp500_etf

### 6. 数値の扱い
- カンマ区切り（1,234,567）は数値として正確に変換する
- 単位（万, 億）がある場合は数値に変換する（例: 1.5万 → 15000）
- 暗号資産は小数点以下8桁まで保持する

## 重要
- JSON 以外は絶対に出力しないこと（前置き・後書き・コードブロック記号も不要）。
- スキーマの全フィールドを必ず含めること（省略不可）。
- セキュリティ上の懸念から、パスワード・秘密鍵・シードフレーズは絶対に記録・言及しないこと。
`.trim();
}

/**
 * 資産抽出用ユーザープロンプトを生成する。
 */
export function buildAssetUserPrompt(rawText: string): string {
  return `
以下の金融テキストから資産情報を抽出し、指定の JSON 形式で出力してください。

---
${rawText.trim()}
---
`.trim();
}

// ===========================
// レスポンスパーサー
// ===========================

/**
 * AI からのレスポンステキストを AssetExtractionResult にパースする。
 * Markdown コードブロックが混入していても除去して試みる。
 *
 * @throws Error - JSON パースに失敗した場合
 */
export function parseAssetResponse(rawText: string): AssetExtractionResult {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```\s*$/im, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `AI レスポンスの JSON パースに失敗しました。\n受信テキスト（先頭200文字）:\n${rawText.slice(0, 200)}`
    );
  }

  if (!isAssetExtractionResult(parsed)) {
    throw new Error(
      `AI レスポンスが期待するスキーマと一致しません。\n受信データ: ${JSON.stringify(parsed).slice(0, 200)}`
    );
  }

  const validatedAssets = parsed.assets.map((a, i) =>
    validateAndSanitizeAsset(a, i)
  );

  // identifier の重複解消
  const deduplicatedAssets = deduplicateIdentifiers(validatedAssets);

  return {
    assets: deduplicatedAssets,
    sourceSummary: String(parsed.sourceSummary ?? ""),
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings.map(String)
      : [],
  };
}

// ===========================
// バリデーション・サニタイズ
// ===========================

const VALID_CATEGORIES: AssetCategory[] = [
  "Cash", "Stock", "Crypto", "Fund", "Bond", "FX", "RealEstate", "Other",
];

const VALID_CURRENCIES: CurrencyCode[] = [
  "JPY", "USD", "EUR", "GBP", "AUD", "CAD", "CHF", "CNY", "HKD",
  "SGD", "KRW", "TWD", "THB", "MXN", "BRL", "INR",
  "BTC", "ETH", "SOL", "XRP", "USDT", "USDC", "BNB", "ADA", "UNKNOWN",
];

function isAssetExtractionResult(value: unknown): value is {
  assets: unknown[];
  sourceSummary: unknown;
  warnings: unknown[];
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "assets" in value &&
    Array.isArray((value as Record<string, unknown>).assets) &&
    "sourceSummary" in value
  );
}

function validateAndSanitizeAsset(raw: unknown, index: number): AssetItem {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`assets[${index}] がオブジェクトではありません`);
  }
  const r = raw as Record<string, unknown>;

  const rawAmount = r.amount;
  const amount = typeof rawAmount === "number"
    ? rawAmount
    : parseFloat(String(rawAmount ?? "0").replace(/,/g, ""));

  const category = VALID_CATEGORIES.includes(r.category as AssetCategory)
    ? (r.category as AssetCategory)
    : "Other";

  const currency = VALID_CURRENCIES.includes(r.currency as CurrencyCode)
    ? (r.currency as CurrencyCode)
    : "UNKNOWN";

  const identifier = String(r.identifier ?? `asset_${index + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, 50);

  return {
    assetName: String(r.assetName ?? `資産 ${index + 1}`).slice(0, 100),
    amount: isNaN(amount) || amount < 0 ? 0 : amount,
    currency,
    category,
    identifier,
    rawAmountText: String(r.rawAmountText ?? ""),
  };
}

/** identifier の重複に _2, _3 ... を付与して一意化する */
function deduplicateIdentifiers(assets: AssetItem[]): AssetItem[] {
  const seen = new Map<string, number>();
  return assets.map((asset) => {
    const base = asset.identifier;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    if (count === 0) return asset;
    return { ...asset, identifier: `${base}_${count + 1}` };
  });
}
