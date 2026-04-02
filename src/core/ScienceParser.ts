/**
 * @file src/core/ScienceParser.ts
 * @description 食材の物理・化学特性を抽出するドメインモデルとプロンプト設計。
 *
 * 設計方針:
 * - AI はパラメータ抽出に専念し、物理計算は TypeScript 側で実施（Constraints 準拠）
 * - 日本語食材名の誤認識を防ぐ Japanese Context を System Instruction に明示
 * - ScienceIngredient は後段の CookingAdvisor が消費する純粋なデータ構造
 */

// ===========================
// ドメインモデル
// ===========================

/** 保存方法 */
export type StorageMethod =
  | "refrigerated"   // 冷蔵（0〜10°C）
  | "frozen"         // 冷凍（-18°C以下）
  | "roomTemp"       // 常温
  | "coolDark";      // 冷暗所

/** 食材カテゴリー */
export type IngredientCategory =
  | "meat"        // 肉類（鶏・豚・牛・羊など）
  | "seafood"     // 魚介類
  | "vegetable"   // 野菜・根菜・葉物
  | "fruit"       // 果物
  | "dairy"       // 乳製品（牛乳・チーズ・バターなど）
  | "grain"       // 穀物・粉類（米・小麦粉・パスタなど）
  | "legume"      // 豆類・大豆製品（豆腐・おからなど）
  | "condiment"   // 調味料・ソース
  | "egg"         // 卵
  | "mushroom"    // きのこ類
  | "seaweed"     // 海藻類（わかめ・昆布など）
  | "processed"   // 加工食品（こんにゃく・はんぺんなど）
  | "fat"         // 油脂類
  | "other";      // その他

/**
 * 食材1件の物理・化学特性。
 * AI が推定する値と TypeScript が計算する値を明確に分離する。
 *
 * 【AI が推定する値（per 100g）】
 * proteinContent, waterContent, fatContent, carbContent,
 * specificHeat, maillardThresholdTemp, storageMethod, shelfLifeDays
 *
 * 【TypeScript が計算する値】
 * CookingAdvisor 内で algorithmically 導出される
 */
export interface ScienceIngredient {
  /** 食材の標準和名（正規化された表記） */
  name: string;
  /** 入力テキストに記載の生の名称（照合・デバッグ用） */
  rawName: string;
  /** 購入時の重量 [g]。記載なければ null */
  weightGram: number | null;
  /** 購入価格 [円]。記載なければ null */
  priceYen: number | null;
  /** 食材カテゴリー */
  category: IngredientCategory;
  /** 保存方法 */
  storageMethod: StorageMethod;

  // ── 栄養成分（per 100g, AI推定値） ──
  /** タンパク質含有量 [g/100g] */
  proteinContent: number;
  /** 水分量 [g/100g] */
  waterContent: number;
  /** 脂質含有量 [g/100g] */
  fatContent: number;
  /** 炭水化物含有量 [g/100g] */
  carbContent: number;

  // ── 物理定数（AI推定値） ──
  /**
   * 比熱容量 [J/(g·K)]。
   * 目安: 水=4.18, タンパク質=2.0, 脂質=1.98, 炭水化物=1.55
   * ※ 食材の比熱は組成比の加重平均で近似可能（後述）
   */
  specificHeat: number;
  /**
   * メイラード反応が有意に進行し始める表面温度 [°C]。
   * 一般的には 140〜165°C。食材の糖・アミノ酸組成に依存。
   */
  maillardThresholdTemp: number;

  // ── 鮮度管理（AI推定値） ──
  /**
   * 冷蔵保存での推定賞味期限 [日]。
   * 開封済み・適切保存を前提とした科学的根拠に基づく推定値。
   */
  shelfLifeDays: number;
  /**
   * 推定賞味期限の算出根拠（AI が日本語で説明）。
   * 例: "Aw 0.99 の高水分食品のため雑菌繁殖が速い"
   */
  shelfLifeReason: string;
}

/** AI からのレスポンス全体 */
export interface ScienceParseResult {
  ingredients: ScienceIngredient[];
  /** 解析の注意・不確実な点 */
  warnings: string[];
  /** 入力テキストのサマリー */
  sourceSummary: string;
}

// ===========================
// JSON スキーマ（プロンプト埋め込み用）
// ===========================

const INGREDIENT_SCHEMA = `
{
  "name": "string — 食材の標準和名（正規化した表記。例: 鶏むね肉、こんにゃく、木綿豆腐）",
  "rawName": "string — 入力テキストに記載されていた元の表記そのまま",
  "weightGram": "number | null — 記載されていた重量をグラム換算した値（記載なければ null）",
  "priceYen": "number | null — 記載されていた価格（円）。税込みがあれば税込み（記載なければ null）",
  "category": "string — meat/seafood/vegetable/fruit/dairy/grain/legume/condiment/egg/mushroom/seaweed/processed/fat/other のいずれか",
  "storageMethod": "string — refrigerated/frozen/roomTemp/coolDark のいずれか",
  "proteinContent": "number — タンパク質 [g/100g]（文部科学省食品成分表の標準値を優先）",
  "waterContent": "number — 水分量 [g/100g]",
  "fatContent": "number — 脂質 [g/100g]",
  "carbContent": "number — 炭水化物 [g/100g]",
  "specificHeat": "number — 比熱容量 [J/(g·K)]（組成比から算出。不明なら 3.5 を使用）",
  "maillardThresholdTemp": "number — メイラード反応開始温度 [°C]（通常 140〜165）",
  "shelfLifeDays": "number — 冷蔵保存での推定賞味期限 [日]（適切保存を前提）",
  "shelfLifeReason": "string — 賞味期限の科学的根拠（日本語100文字以内）"
}`.trim();

// ===========================
// プロンプト生成
// ===========================

/**
 * 食材解析用システムプロンプトを生成する。
 *
 * 日本語コンテキストを冒頭に強調し、日本固有食材（こんにゃく・おから等）の
 * 誤解をグローバルモデルに対して明示的に防ぐ。
 */
export function buildScienceSystemPrompt(): string {
  return `
あなたは食品科学・栄養学の専門家AIです。
日本の食材・料理に精通しており、レシートや購入リストから食材の物理・化学特性を抽出します。

## ⚠️ 日本語コンテキスト（最重要）
このシステムは日本の食材を扱います。以下の点に特に注意してください:

- **こんにゃく（蒟蒻）**: グルコマンナンを主成分とするゲル状食品。水分 97% 以上。カロリーほぼゼロ。
  ※ "konjac" と同義。「しらたき」も同じカテゴリー（processed）。
- **おから**: 大豆から豆乳を搾った後の残渣。食物繊維が豊富。(legume カテゴリー)
- **はんぺん**: 白身魚のすり身と山芋で作る蒸し物。(processed カテゴリー)
- **厚揚げ / 油揚げ**: 豆腐を揚げた食品。(legume カテゴリー)
- **ごぼう**: キク科の根菜。食物繊維豊富。英語では "burdock root"。(vegetable)
- **れんこん（蓮根）**: 水分が多く、ポリフェノールを含む根菜。(vegetable)
- **みょうが**: ショウガ科の香味野菜。英語では "Japanese ginger"。(vegetable)
- 日本の食品表示は「100gあたり」または「1食あたり」で記載されることが多い。
- 価格には消費税（8% または 10%）が含まれる場合がある。

## 出力形式（厳守）
JSON のみを出力すること。コードブロック記号（\`\`\`）・説明文・前置き・後書きは一切含めないこと。

出力する JSON の構造:
{
  "ingredients": [
    ${INGREDIENT_SCHEMA}
  ],
  "warnings": ["string — 不確かな値・識別できなかった食材など（空なら []）"],
  "sourceSummary": "string — 入力データの概要（50文字以内）"
}

## 栄養成分の推定方針
1. 文部科学省「日本食品標準成分表2020年版」の値を最優先で使用する。
2. 加工度・調理状態（生/茹で/焼き）に応じて値を調整する。
3. 複合食品（弁当・惣菜等）は主要成分の平均で推定する。
4. 不明な場合は同カテゴリーの標準値を使用し、warnings に記載する。

## 比熱容量の推定式
比熱 ≈ (水分率 × 4.18) + (タンパク質率 × 2.00) + (脂質率 × 1.98) + (炭水化物率 × 1.55)
※ 各率は 0〜1 の小数（例: 水分70g/100g → 0.70）

## スキーマ必須事項
- 全フィールドを必ず含めること（省略不可）
- 数値フィールドに文字列を入れないこと
- category・storageMethod は指定された値のみ使用すること
`.trim();
}

/**
 * 食材解析用ユーザープロンプトを生成する。
 */
export function buildScienceUserPrompt(rawText: string): string {
  return `
以下の購入リスト・レシートから食材を抽出し、物理・化学特性を推定して JSON で返してください。

【入力テキスト】
---
${rawText.trim()}
---

購入リストに含まれる食材・食品を全て抽出してください。
日用品（洗剤・シャンプー等）や猫用品は ingredients に含めず、warnings に記載してください。
`.trim();
}

// ===========================
// レスポンスパーサー
// ===========================

/**
 * AI からのレスポンステキストを ScienceParseResult にパースする。
 *
 * @throws Error - JSON パースに失敗した場合
 */
export function parseScienceResponse(rawText: string): ScienceParseResult {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```\s*$/im, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `JSON パースに失敗しました。\n受信テキスト（先頭200文字）:\n${rawText.slice(0, 200)}`
    );
  }

  if (!isScienceParseResult(parsed)) {
    throw new Error(
      `スキーマと一致しません。\n受信データ: ${JSON.stringify(parsed).slice(0, 200)}`
    );
  }

  const validated = parsed.ingredients.map((item, i) =>
    validateIngredient(item, i)
  );

  return {
    ingredients: validated,
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings.map(String)
      : [],
    sourceSummary: String(parsed.sourceSummary ?? ""),
  };
}

// ===========================
// バリデーション
// ===========================

const VALID_CATEGORIES: IngredientCategory[] = [
  "meat", "seafood", "vegetable", "fruit", "dairy", "grain",
  "legume", "condiment", "egg", "mushroom", "seaweed", "processed", "fat", "other",
];

const VALID_STORAGE: StorageMethod[] = [
  "refrigerated", "frozen", "roomTemp", "coolDark",
];

function isScienceParseResult(v: unknown): v is {
  ingredients: unknown[];
  warnings: unknown[];
  sourceSummary: unknown;
} {
  return (
    typeof v === "object" &&
    v !== null &&
    "ingredients" in v &&
    Array.isArray((v as Record<string, unknown>).ingredients)
  );
}

/** 数値フィールドを安全にパースし、範囲外の場合はデフォルト値に丸める */
function clampNum(
  val: unknown,
  min: number,
  max: number,
  defaultVal: number
): number {
  const n = typeof val === "number" ? val : parseFloat(String(val ?? ""));
  if (isNaN(n)) return defaultVal;
  return Math.min(max, Math.max(min, n));
}

function validateIngredient(raw: unknown, index: number): ScienceIngredient {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`ingredients[${index}] がオブジェクトではありません`);
  }
  const r = raw as Record<string, unknown>;

  return {
    name: String(r.name ?? `食材 ${index + 1}`).slice(0, 60),
    rawName: String(r.rawName ?? "").slice(0, 60),
    weightGram:
      r.weightGram === null || r.weightGram === undefined
        ? null
        : clampNum(r.weightGram, 0, 100000, 100),
    priceYen:
      r.priceYen === null || r.priceYen === undefined
        ? null
        : clampNum(r.priceYen, 0, 1000000, 0),
    category: VALID_CATEGORIES.includes(r.category as IngredientCategory)
      ? (r.category as IngredientCategory)
      : "other",
    storageMethod: VALID_STORAGE.includes(r.storageMethod as StorageMethod)
      ? (r.storageMethod as StorageMethod)
      : "refrigerated",
    // 栄養成分: 合計が 100g を超えないようクランプ（水分 + タンパク + 脂質 + 炭水 ≤ 100）
    proteinContent: clampNum(r.proteinContent, 0, 100, 15),
    waterContent: clampNum(r.waterContent, 0, 99, 70),
    fatContent: clampNum(r.fatContent, 0, 100, 5),
    carbContent: clampNum(r.carbContent, 0, 100, 5),
    // 物理定数
    specificHeat: clampNum(r.specificHeat, 0.5, 4.5, 3.5),
    maillardThresholdTemp: clampNum(r.maillardThresholdTemp, 100, 200, 150),
    // 鮮度管理
    shelfLifeDays: clampNum(r.shelfLifeDays, 0, 365, 3),
    shelfLifeReason: String(r.shelfLifeReason ?? "").slice(0, 150),
  };
}
