/**
 * @file src/core/CatInventory.ts
 * @description 猫の消耗品在庫管理・消費予測ロジック。
 *
 * 設計方針:
 * - 猫砂・餌に限らず、将来の「引っかき耐性布メンテナンス」「健康ログ」への拡張性を持つデータ構造
 * - 残り日数 3日以内で警告、0日以下で緊急アラート
 * - 消費量の変動（猫の体重・季節・健康状態）を考慮した予測モデル
 */

// ===========================
// ドメインモデル
// ===========================

/**
 * 猫用消耗品のカテゴリー。
 * 拡張性を持たせるためユニオン型で定義。
 */
export type CatSupplyCategory =
  | "litter"          // 猫砂（ベントナイト・紙砂・木砂など）
  | "dryFood"         // ドライフード（カリカリ）
  | "wetFood"         // ウェットフード（缶・パウチ）
  | "treat"           // おやつ・スナック
  | "supplement"      // サプリメント（関節・毛玉ケアなど）
  | "fabricMaintenance" // 引っかき耐性布地メンテナンス用品（スプレー・シート等）
  | "medicine"        // 薬・外用薬
  | "hygiene"         // 衛生用品（シャンプー・ウェットティッシュ等）
  | "other";          // その他

/** 在庫ステータス区分 */
export type StockStatusLevel =
  | "ok"       // 余裕あり（7日超）
  | "warning"  // 注意（3〜7日）
  | "critical" // 緊急（3日以内）
  | "empty";   // 在庫なし

/**
 * 猫用消耗品の在庫状況。
 *
 * 拡張性設計:
 * - healthLog: 将来の健康管理ログへの拡張ポイント
 * - notes: 引っかき被害の記録・布地メンテナンス情報など自由記述
 */
export interface StockStatus {
  /** 品目ID（スネークケース、照合キー） */
  id: string;
  /** 品目名（例: "花王 ニャンとも清潔トイレ 脱臭・抗菌チップ"） */
  name: string;
  /** カテゴリー */
  category: CatSupplyCategory;
  /** 現在の在庫量 */
  currentAmount: number;
  /** 単位（例: "g", "袋", "個", "mL"） */
  unit: string;
  /** 1日あたりの平均消費量（同単位） */
  dailyConsumption: number;
  /** 残り日数（計算値） */
  remainingDays: number;
  /** ステータス区分 */
  statusLevel: StockStatusLevel;
  /** 推奨購入量（在庫をバッファ分まで補充する量） */
  recommendedPurchaseAmount: number;
  /**
   * 消費量変動係数（0〜1）。
   * 猫の体調・季節による変動を考慮。0 = 変動なし、1 = 最大変動。
   */
  consumptionVariability: number;
  /**
   * 健康ログへの拡張ポイント。
   * 将来: { date, weight, appetite, notes }[] などに拡張可能。
   */
  healthLog: HealthLogEntry[];
  /**
   * 自由記述メモ。
   * 用途例: 引っかき被害の記録、布地メンテナンス時期、病院受診記録など。
   */
  notes: string;
  /** 最終更新日時 */
  lastUpdated: string;
}

/** 健康ログのエントリ（将来拡張用） */
export interface HealthLogEntry {
  date: string;       // YYYY-MM-DD
  weight?: number;    // 体重 [kg]
  appetite?: "good" | "normal" | "poor";
  note?: string;
}

/** 在庫サマリー（全品目の集計結果） */
export interface InventorySummary {
  criticalItems: StockStatus[];  // 緊急補充が必要な品目
  warningItems: StockStatus[];   // 注意が必要な品目
  okItems: StockStatus[];        // 余裕あり
  emptyItems: StockStatus[];     // 在庫切れ
  nextShoppingList: ShoppingItem[]; // 推奨購入リスト
}

/** 買い物リスト1件 */
export interface ShoppingItem {
  name: string;
  amount: number;
  unit: string;
  urgency: "urgent" | "soon" | "when_convenient";
  estimatedDaysUntilEmpty: number;
}

// ===========================
// 在庫計算エンジン
// ===========================

/** 警告閾値 [日] */
const THRESHOLD_CRITICAL = 3;
const THRESHOLD_WARNING = 7;

/** 購入バッファ（この日数分を在庫として確保する） */
const PURCHASE_BUFFER_DAYS = 14;

/**
 * 在庫量と日消費量から在庫ステータスを計算する。
 *
 * @param currentAmount - 現在の在庫量
 * @param dailyConsumption - 1日の平均消費量
 * @param unit - 単位
 * @param variability - 消費量変動係数（0〜1）。大きいほど安全バッファを多く取る
 * @returns { remainingDays, statusLevel, recommendedPurchaseAmount }
 */
export function calcStockStatus(
  currentAmount: number,
  dailyConsumption: number,
  _unit: string,
  variability = 0.2
): Pick<StockStatus, "remainingDays" | "statusLevel" | "recommendedPurchaseAmount"> {
  if (dailyConsumption <= 0) {
    return {
      remainingDays: Infinity,
      statusLevel: "ok",
      recommendedPurchaseAmount: 0,
    };
  }

  // 残り日数（変動を考慮した保守的な推定）
  // 変動が大きい場合、有効消費量を増やして残り日数を短めに見積もる
  const effectiveConsumption = dailyConsumption * (1 + variability * 0.5);
  const remainingDays = Math.floor(currentAmount / effectiveConsumption);

  // ステータス判定
  let statusLevel: StockStatusLevel;
  if (currentAmount <= 0) {
    statusLevel = "empty";
  } else if (remainingDays <= THRESHOLD_CRITICAL) {
    statusLevel = "critical";
  } else if (remainingDays <= THRESHOLD_WARNING) {
    statusLevel = "warning";
  } else {
    statusLevel = "ok";
  }

  // 推奨購入量: バッファ日数分を補充する量
  const targetAmount = dailyConsumption * PURCHASE_BUFFER_DAYS;
  const recommendedPurchaseAmount = Math.max(
    0,
    Math.ceil(targetAmount - currentAmount)
  );

  return {
    remainingDays: isFinite(remainingDays) ? remainingDays : 9999,
    statusLevel,
    recommendedPurchaseAmount,
  };
}

/**
 * StockStatus オブジェクトを生成するファクトリ関数。
 */
export function createStockStatus(params: {
  id: string;
  name: string;
  category: CatSupplyCategory;
  currentAmount: number;
  unit: string;
  dailyConsumption: number;
  consumptionVariability?: number;
  healthLog?: HealthLogEntry[];
  notes?: string;
}): StockStatus {
  const variability = params.consumptionVariability ?? 0.2;
  const { remainingDays, statusLevel, recommendedPurchaseAmount } =
    calcStockStatus(
      params.currentAmount,
      params.dailyConsumption,
      params.unit,
      variability
    );

  return {
    id: params.id,
    name: params.name,
    category: params.category,
    currentAmount: params.currentAmount,
    unit: params.unit,
    dailyConsumption: params.dailyConsumption,
    remainingDays,
    statusLevel,
    recommendedPurchaseAmount,
    consumptionVariability: variability,
    healthLog: params.healthLog ?? [],
    notes: params.notes ?? "",
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * 在庫リスト全体のサマリーを生成する。
 */
export function buildInventorySummary(items: StockStatus[]): InventorySummary {
  const criticalItems = items.filter((i) => i.statusLevel === "critical");
  const warningItems = items.filter((i) => i.statusLevel === "warning");
  const okItems = items.filter((i) => i.statusLevel === "ok");
  const emptyItems = items.filter((i) => i.statusLevel === "empty");

  // 買い物リスト: empty > critical > warning の順に並べる
  const needPurchase = [...emptyItems, ...criticalItems, ...warningItems];
  const nextShoppingList: ShoppingItem[] = needPurchase
    .filter((i) => i.recommendedPurchaseAmount > 0)
    .map((i) => ({
      name: i.name,
      amount: i.recommendedPurchaseAmount,
      unit: i.unit,
      urgency:
        i.statusLevel === "empty" || i.statusLevel === "critical"
          ? "urgent"
          : i.remainingDays <= 5
          ? "soon"
          : "when_convenient",
      estimatedDaysUntilEmpty: i.remainingDays,
    }));

  return { criticalItems, warningItems, okItems, emptyItems, nextShoppingList };
}

// ===========================
// 表示カラーコード（スプレッドシート用）
// ===========================

/**
 * StockStatus から Google Sheets 背景色コードを返す。
 * ダッシュボードの警告色表示に使用する。
 */
export function getStatusColor(level: StockStatusLevel): string {
  switch (level) {
    case "empty":    return "#d50000"; // 赤（Google Material Red 900）
    case "critical": return "#ff6d00"; // 橙（Deep Orange Accent 700）
    case "warning":  return "#f9a825"; // 黄（Amber 800）
    case "ok":       return "#2e7d32"; // 緑（Green 800）
  }
}

/**
 * StockStatus からステータスラベル文字列を返す。
 */
export function getStatusLabel(level: StockStatusLevel): string {
  switch (level) {
    case "empty":    return "🔴 在庫切れ";
    case "critical": return "🟠 緊急補充";
    case "warning":  return "🟡 要注意";
    case "ok":       return "🟢 余裕あり";
  }
}

/**
 * カテゴリー別の標準1日消費量ガイド（初期設定の参考値）。
 * 猫 1匹・体重 4kg の標準的な消費量。
 */
export const DEFAULT_DAILY_CONSUMPTION: Record<CatSupplyCategory, { amount: number; unit: string }> = {
  litter:             { amount: 50,  unit: "g" },    // 猫砂: 1回15g × 3回 ≈ 45g
  dryFood:            { amount: 60,  unit: "g" },    // ドライ: 体重4kg × 15g/kg = 60g
  wetFood:            { amount: 75,  unit: "g" },    // ウェット: 1パウチ（75g）
  treat:              { amount: 5,   unit: "g" },    // おやつ: 少量
  supplement:         { amount: 1,   unit: "粒" },   // サプリ: 1日1〜2粒
  fabricMaintenance:  { amount: 1,   unit: "回" },   // 布メンテ: 週1〜2回使用
  medicine:           { amount: 1,   unit: "回" },   // 薬: 医師指示に従う
  hygiene:            { amount: 1,   unit: "枚" },   // ウェットティッシュ等
  other:              { amount: 1,   unit: "個" },
};
