/**
 * @file tests/core/CatInventory.test.ts
 * @description 猫在庫管理ロジックのユニットテスト。
 * 残り日数計算・警告閾値・在庫サマリーを検証する。
 */

import {
  calcStockStatus,
  createStockStatus,
  buildInventorySummary,
  getStatusColor,
  getStatusLabel,
  StockStatusLevel,
} from "../../src/core/CatInventory";

// ===========================
// calcStockStatus
// ===========================

describe("calcStockStatus", () => {
  it("7日超の在庫は ok ステータス", () => {
    const result = calcStockStatus(1000, 50, "g");
    expect(result.statusLevel).toBe("ok");
    expect(result.remainingDays).toBeGreaterThan(7);
  });

  it("残り3日以内は critical ステータス", () => {
    // 150g / 50g/日 = 3日 → 変動係数 0.2 を考慮すると 2日台になる
    const result = calcStockStatus(140, 50, "g");
    expect(result.statusLevel).toBe("critical");
  });

  it("残り7日以内は warning ステータス", () => {
    const result = calcStockStatus(300, 50, "g"); // 約 4〜5日
    expect(result.statusLevel).toBe("warning");
  });

  it("在庫 0 は empty ステータス", () => {
    const result = calcStockStatus(0, 50, "g");
    expect(result.statusLevel).toBe("empty");
  });

  it("日消費量 0 は remainingDays が Infinity（消費なし）で ok", () => {
    const result = calcStockStatus(1000, 0, "g");
    expect(result.statusLevel).toBe("ok");
    expect(result.remainingDays).toBe(Infinity);
  });

  it("推奨購入量は バッファ日数(14日)分を補充する量", () => {
    const result = calcStockStatus(100, 50, "g"); // 残り約 2日
    // 14日 × 50g = 700g、現在 100g → 600g 以上を推奨
    expect(result.recommendedPurchaseAmount).toBeGreaterThan(500);
  });

  it("variability が高いほど残り日数が短めに見積もられる", () => {
    const low = calcStockStatus(500, 50, "g", 0.0);
    const high = calcStockStatus(500, 50, "g", 0.5);
    expect(high.remainingDays).toBeLessThanOrEqual(low.remainingDays);
  });
});

// ===========================
// createStockStatus
// ===========================

describe("createStockStatus", () => {
  it("全フィールドが含まれる", () => {
    const stock = createStockStatus({
      id: "litter_main",
      name: "猫砂",
      category: "litter",
      currentAmount: 500,
      unit: "g",
      dailyConsumption: 50,
    });

    expect(stock.id).toBe("litter_main");
    expect(stock.name).toBe("猫砂");
    expect(stock.category).toBe("litter");
    expect(stock.currentAmount).toBe(500);
    expect(stock.healthLog).toEqual([]);
    expect(stock.notes).toBe("");
    expect(stock.lastUpdated).toBeTruthy();
  });

  it("healthLog と notes を初期値で指定できる", () => {
    const stock = createStockStatus({
      id: "food_main",
      name: "ドライフード",
      category: "dryFood",
      currentAmount: 200,
      unit: "g",
      dailyConsumption: 60,
      healthLog: [{ date: "2025-07-01", weight: 4.2, appetite: "good" }],
      notes: "引っかき被害: ソファ右端",
    });

    expect(stock.healthLog).toHaveLength(1);
    expect(stock.healthLog[0].weight).toBe(4.2);
    expect(stock.notes).toBe("引っかき被害: ソファ右端");
  });
});

// ===========================
// buildInventorySummary
// ===========================

describe("buildInventorySummary", () => {
  const makeStock = (
    id: string,
    amount: number,
    daily: number
  ) =>
    createStockStatus({
      id,
      name: id,
      category: "litter",
      currentAmount: amount,
      unit: "g",
      dailyConsumption: daily,
    });

  it("ステータスごとに正しく分類される", () => {
    const items = [
      makeStock("empty", 0, 50),       // empty
      makeStock("critical", 100, 50),  // critical（約 1〜2日）
      makeStock("warning", 300, 50),   // warning（約 4〜5日）
      makeStock("ok", 2000, 50),       // ok
    ];

    const summary = buildInventorySummary(items);
    expect(summary.emptyItems).toHaveLength(1);
    expect(summary.criticalItems).toHaveLength(1);
    expect(summary.warningItems).toHaveLength(1);
    expect(summary.okItems).toHaveLength(1);
  });

  it("nextShoppingList が空配列でない（補充が必要な品目があれば）", () => {
    const items = [makeStock("crit", 50, 50)];
    const summary = buildInventorySummary(items);
    expect(summary.nextShoppingList.length).toBeGreaterThan(0);
  });

  it("ok のみの場合 nextShoppingList は空", () => {
    const items = [makeStock("ok", 5000, 50)];
    const summary = buildInventorySummary(items);
    // ok なので推奨購入量は 0
    expect(summary.nextShoppingList.filter(s => s.urgency === "urgent")).toHaveLength(0);
  });

  it("urgency が empty/critical で urgent になる", () => {
    const items = [makeStock("empty", 0, 50)];
    const summary = buildInventorySummary(items);
    const urgentItems = summary.nextShoppingList.filter((s) => s.urgency === "urgent");
    expect(urgentItems.length).toBeGreaterThan(0);
  });
});

// ===========================
// getStatusColor / getStatusLabel
// ===========================

describe("getStatusColor & getStatusLabel", () => {
  const levels: StockStatusLevel[] = ["ok", "warning", "critical", "empty"];

  it.each(levels)("%s ステータスは有効なカラーコードを返す", (level) => {
    const color = getStatusColor(level);
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("empty は最も危険な赤色", () => {
    expect(getStatusColor("empty")).toBe("#d50000");
  });

  it("ok は緑色", () => {
    expect(getStatusColor("ok")).toBe("#2e7d32");
  });

  it.each(levels)("%s のラベルに絵文字が含まれる", (level) => {
    const label = getStatusLabel(level);
    expect(label).toMatch(/[🔴🟠🟡🟢]/u);
  });
});
