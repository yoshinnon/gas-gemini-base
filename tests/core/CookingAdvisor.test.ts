/**
 * @file tests/core/CookingAdvisor.test.ts
 * @description 調理最適化エンジンの物理計算テスト。
 * TypeScript 側の数式実装を重点的に検証する。
 */

import {
  calcSpecificHeat,
  calculateOptimalSearing,
  calcPastaEmulsification,
  predictHeatingTime,
  generateCookingAdvice,
} from "../../src/core/CookingAdvisor";
import { ScienceIngredient } from "../../src/core/ScienceParser";

// ===========================
// テスト用フィクスチャ
// ===========================

/** 鶏むね肉の標準的な特性値 */
const chickenBreast: ScienceIngredient = {
  name: "鶏むね肉",
  rawName: "鶏むね肉",
  weightGram: 300,
  priceYen: 398,
  category: "meat",
  storageMethod: "refrigerated",
  proteinContent: 23.3,
  waterContent: 73.0,
  fatContent: 1.9,
  carbContent: 0,
  specificHeat: 3.5,
  maillardThresholdTemp: 150,
  shelfLifeDays: 2,
  shelfLifeReason: "高水分・高タンパクで細菌繁殖が速い",
};

/** こんにゃくの標準的な特性値 */
const konjac: ScienceIngredient = {
  name: "こんにゃく",
  rawName: "こんにゃく",
  weightGram: 250,
  priceYen: 98,
  category: "processed",
  storageMethod: "refrigerated",
  proteinContent: 0.1,
  waterContent: 97.3,
  fatContent: 0,
  carbContent: 2.3,
  specificHeat: 4.1,
  maillardThresholdTemp: 165,
  shelfLifeDays: 30,
  shelfLifeReason: "高アルカリ製法で雑菌繁殖を抑制",
};

/** チーズ（低水分食材）*/
const cheese: ScienceIngredient = {
  name: "チェダーチーズ",
  rawName: "チェダーチーズ",
  weightGram: 100,
  priceYen: 280,
  category: "dairy",
  storageMethod: "refrigerated",
  proteinContent: 25.7,
  waterContent: 36.7,
  fatContent: 33.8,
  carbContent: 2.1,
  specificHeat: 2.2,
  maillardThresholdTemp: 145,
  shelfLifeDays: 30,
  shelfLifeReason: "低水分・高脂質で腐敗しにくい",
};

// ===========================
// calcSpecificHeat
// ===========================

describe("calcSpecificHeat", () => {
  it("鶏むね肉の比熱が物理的に合理的な範囲（2.5〜4.2）に収まる", () => {
    const cp = calcSpecificHeat(chickenBreast);
    expect(cp).toBeGreaterThan(2.5);
    expect(cp).toBeLessThan(4.2);
  });

  it("こんにゃく（水分97%）は水に近い高い比熱を持つ", () => {
    const cp = calcSpecificHeat(konjac);
    // 水分 97% → 4.18 × 0.97 ≈ 4.05 付近
    expect(cp).toBeGreaterThan(3.8);
  });

  it("チーズ（水分37%）は低い比熱を持つ", () => {
    const cp = calcSpecificHeat(cheese);
    // 水分 37% なので比熱は低め
    expect(cp).toBeLessThan(3.0);
  });

  it("水のみの場合（水分100%）は 4.182 に近い値を返す", () => {
    const pureWater: ScienceIngredient = {
      ...chickenBreast,
      proteinContent: 0,
      waterContent: 100,
      fatContent: 0,
      carbContent: 0,
    };
    const cp = calcSpecificHeat(pureWater);
    expect(cp).toBeCloseTo(4.182, 1);
  });
});

// ===========================
// calculateOptimalSearing
// ===========================

describe("calculateOptimalSearing", () => {
  it("こんにゃくのメイラードスコアは低い（低タンパク・高水分）", () => {
    const result = calculateOptimalSearing(konjac);
    expect(result.maillardScore).toBeLessThan(10);
  });

  it("鶏むね肉はこんにゃくよりメイラードスコアが高い", () => {
    const chickenScore = calculateOptimalSearing(chickenBreast).maillardScore;
    const konjacScore = calculateOptimalSearing(konjac).maillardScore;
    expect(chickenScore).toBeGreaterThan(konjacScore);
  });

  it("こんにゃくには moistureTip が含まれる（高水分食材への注意）", () => {
    const result = calculateOptimalSearing(konjac);
    expect(result.moistureTip).not.toBeNull();
    expect(result.moistureTip).toContain("こんにゃく");
  });

  it("チーズ（低水分）には焦げ注意の moistureTip が返る", () => {
    const result = calculateOptimalSearing(cheese);
    expect(result.moistureTip).not.toBeNull();
  });

  it("推奨温度範囲の下限が上限より低い（正しい範囲）", () => {
    const result = calculateOptimalSearing(chickenBreast);
    expect(result.targetPanTempRange[0]).toBeLessThan(result.targetPanTempRange[1]);
  });

  it("rationale に物理計算の根拠が含まれる", () => {
    const result = calculateOptimalSearing(chickenBreast);
    expect(result.rationale).toContain("比熱容量");
    expect(result.rationale).toContain("蒸発");
    expect(result.rationale).toContain("メイラード反応スコア");
  });

  it("drySurfaceTimeSec は正の整数", () => {
    const result = calculateOptimalSearing(chickenBreast);
    expect(result.drySurfaceTimeSec).toBeGreaterThan(0);
    expect(Number.isInteger(result.drySurfaceTimeSec)).toBe(true);
  });
});

// ===========================
// calcPastaEmulsification
// ===========================

describe("calcPastaEmulsification", () => {
  it("パスタ100g で brothMl が 45ml 以上", () => {
    const guide = calcPastaEmulsification(100, 480);
    expect(guide.brothMl).toBeGreaterThanOrEqual(45);
  });

  it("パスタ重量に比例して brothMl が増える", () => {
    const guide100 = calcPastaEmulsification(100, 480);
    const guide200 = calcPastaEmulsification(200, 480);
    expect(guide200.brothMl).toBeCloseTo(guide100.brothMl * 2, 0);
  });

  it("steps に 6 つ以上のステップが含まれる", () => {
    const guide = calcPastaEmulsification(100, 480);
    expect(guide.steps.length).toBeGreaterThanOrEqual(6);
  });

  it("estimatedWaterAbsorptionG は正の値", () => {
    const guide = calcPastaEmulsification(100, 480);
    expect(guide.estimatedWaterAbsorptionG).toBeGreaterThan(0);
  });

  it("長時間茹でるほど水分吸収量が増える", () => {
    const short = calcPastaEmulsification(100, 300); // 5分
    const long = calcPastaEmulsification(100, 720);  // 12分
    expect(long.estimatedWaterAbsorptionG).toBeGreaterThan(short.estimatedWaterAbsorptionG);
  });
});

// ===========================
// predictHeatingTime
// ===========================

describe("predictHeatingTime", () => {
  it("厚みが大きいほど 75°C 到達時間が長い", () => {
    const thin = predictHeatingTime(chickenBreast, 75, 5, 200, 10);
    const thick = predictHeatingTime(chickenBreast, 75, 5, 200, 30);
    expect(thick.timeTo75CSec).toBeGreaterThan(thin.timeTo75CSec);
  });

  it("表面温度が高いほど到達時間が短い", () => {
    const low = predictHeatingTime(chickenBreast, 75, 5, 160, 20);
    const high = predictHeatingTime(chickenBreast, 75, 5, 250, 20);
    expect(high.timeTo75CSec).toBeLessThan(low.timeTo75CSec);
  });

  it("restTimeSec は 30 秒以上", () => {
    const result = predictHeatingTime(chickenBreast, 75, 5, 200, 20);
    expect(result.restTimeSec).toBeGreaterThanOrEqual(30);
  });
});

// ===========================
// generateCookingAdvice (統合)
// ===========================

describe("generateCookingAdvice", () => {
  it("shelfLifeAlert が賞味期限 2日以内の食材で返る", () => {
    const advice = generateCookingAdvice(chickenBreast);
    expect(advice.shelfLifeAlert).not.toBeNull();
    expect(advice.shelfLifeAlert).toContain("鶏むね肉");
  });

  it("賞味期限が余裕ある食材では shelfLifeAlert が null", () => {
    const advice = generateCookingAdvice(konjac); // 30日
    expect(advice.shelfLifeAlert).toBeNull();
  });

  it("summary に主要情報が含まれる", () => {
    const advice = generateCookingAdvice(chickenBreast);
    expect(advice.summary).toContain("鶏むね肉");
    expect(advice.summary).toContain("メイラード反応スコア");
    expect(advice.summary).toContain("比熱");
  });
});
