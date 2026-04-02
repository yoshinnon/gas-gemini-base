/**
 * @file src/core/CookingAdvisor.ts
 * @description 物理・化学モデルに基づく調理最適化エンジン。
 *
 * 設計方針（Constraints 準拠）:
 * - 比熱・メイラード反応・乳化などの物理計算は TypeScript の数式で実装
 * - AI はパラメータ（proteinContent, waterContent など）の抽出のみを担当
 * - すべての計算式に参照文献・根拠コメントを付記する
 */

import { ScienceIngredient } from "./ScienceParser";

// ===========================
// 物理定数
// ===========================

/**
 * 各食品成分の比熱容量 [J/(g·K)]
 * 参照: Choi & Okos (1986), "Effects of temperature and composition on the
 *       thermal properties of foods"
 */
const SPECIFIC_HEAT = {
  water: 4.182,       // 20°C での純水比熱
  protein: 2.008,
  fat: 1.984,
  carbohydrate: 1.549,
  ash: 1.093,         // ミネラル分（灰分）
} as const;

/** 熱伝達の参考値 */
const THERMAL = {
  /** ステンレスパン（厚さ 3mm）の熱抵抗の目安 [K/W] */
  panThermalResistance: 0.002,
  /** 油の沸点（発煙点以下の上限目安） [°C] */
  oilMaxTemp: 220,
  /** 家庭用コンロの最大出力 [W]（強火の目安） */
  burnerMaxPower: 3500,
} as const;

/** 乳化に関する定数 */
const EMULSIFICATION = {
  /**
   * パスタ 100g 当たりの乳化に必要な茹で汁の最低量 [mL]。
   * 科学的根拠: でん粉粒子とグルテンが水中で分散し O/W 型エマルションを
   * 形成するには表面積あたり最低 1.5mL/g の水が必要（Barham et al., 2010 の推計値）
   */
  minBrothPerPastaMl: 45,
  /**
   * バター（または油）の推奨比率 [g per 100g pasta]。
   * W/O エマルションを O/W に転相させるための界面活性剤（レシチン）を
   * バターが供給するための最低量。
   */
  butterPerPastaG: 10,
} as const;

// ===========================
// 比熱計算（TypeScript 実装）
// ===========================

/**
 * 食材の比熱容量を Choi-Okos 式で計算する。
 * AI が推定した値の検証・補正に使用。
 *
 * 計算式:
 *   c_p = Σ (成分の質量分率 × その成分の比熱)
 *
 * @param item - ScienceIngredient（栄養成分は per 100g）
 * @returns 比熱容量 [J/(g·K)]
 */
export function calcSpecificHeat(item: ScienceIngredient): number {
  const w = item.waterContent / 100;
  const p = item.proteinContent / 100;
  const f = item.fatContent / 100;
  const c = item.carbContent / 100;
  // 灰分（ミネラル）= 残余（100 - 水分 - タンパク - 脂質 - 炭水化物）
  const ash = Math.max(0, 1 - w - p - f - c);

  const cp =
    w * SPECIFIC_HEAT.water +
    p * SPECIFIC_HEAT.protein +
    f * SPECIFIC_HEAT.fat +
    c * SPECIFIC_HEAT.carbohydrate +
    ash * SPECIFIC_HEAT.ash;

  // 有効数字3桁で返す
  return Math.round(cp * 1000) / 1000;
}

// ===========================
// メイラード反応分析
// ===========================

export interface MaillardAnalysis {
  /** 表面を乾燥させるのに必要な推定時間 [秒] */
  drySurfaceTimeSec: number;
  /**
   * 推奨火加減の説明
   * 例: "強火（220-240°C）で片面 90秒"
   */
  heatLevelDescription: string;
  /** 鍋面温度の推奨範囲 [°C] */
  targetPanTempRange: [number, number];
  /** 水分が多い食材向けの追加アドバイス */
  moistureTip: string | null;
  /** メイラード反応の期待度（0-100） */
  maillardScore: number;
  /**
   * 計算の根拠テキスト（ユーザー向け表示用）
   * TypeScript の数式計算過程を日本語で説明する
   */
  rationale: string;
}

/**
 * 食材の水分量とタンパク質量から表面をカリッとさせる（メイラード反応を促進する）
 * ための理想的な火加減と時間を計算する。
 *
 * 物理モデル:
 * 1. 表面水分の蒸発エネルギー  Q_evap = m_water × Lv
 *    （Lv: 水の蒸発潜熱 = 2257 J/g @100°C）
 * 2. 表面 1cm² × 1mm 厚の層を乾燥させる時間 = Q_evap / (熱フラックス × 面積)
 *    熱フラックスは火加減（W/m²）から推算
 * 3. メイラード反応スコア: タンパク質率と低水分率が高いほどスコアアップ
 *
 * @param item - ScienceIngredient
 * @returns MaillardAnalysis
 */
export function calculateOptimalSearing(item: ScienceIngredient): MaillardAnalysis {
  const waterFrac = item.waterContent / 100;
  const proteinFrac = item.proteinContent / 100;

  // ── Step 1: 表面乾燥に必要なエネルギー推算 ──────────────────────────
  // 仮定: 表面層は 1cm² × 深さ 0.5mm = 0.05cm³ ≈ 0.05g（密度≈1）
  const surfaceMassG = 0.05;
  const surfaceWaterG = surfaceMassG * waterFrac;
  const evapHeatJ = surfaceWaterG * 2257; // 蒸発潜熱 2257 J/g

  // 強火(3000W)が 20cm径パン(面積314cm²)に均等に伝達される場合の熱フラックス
  const heatFluxWPerCm2 = THERMAL.burnerMaxPower / 314;
  // 表面 1cm² に伝わる熱量 [J/s]
  const surfaceHeatInputW = heatFluxWPerCm2 * 1;
  // 表面乾燥時間 [秒]
  const drySurfaceTimeSec = Math.round(evapHeatJ / surfaceHeatInputW);

  // ── Step 2: 鍋面温度の推奨範囲 ──────────────────────────────────────
  // メイラード反応はアミノ酸と還元糖が 140°C 以上で反応する（Maillard, 1912）
  // 高水分食材は 100°C に近い温度で蒸発が優先するため、さらに高温が必要
  const lowerPanTemp = Math.round(item.maillardThresholdTemp + waterFrac * 30);
  const upperPanTemp = Math.min(THERMAL.oilMaxTemp, lowerPanTemp + 30);

  // ── Step 3: 推奨火加減の決定 ─────────────────────────────────────────
  let heatLevelDescription: string;
  let moistureTip: string | null = null;

  if (waterFrac >= 0.85) {
    // 超高水分（こんにゃく・もやしなど）: 蒸発を促進してから焼く
    heatLevelDescription =
      `強火（${lowerPanTemp}〜${upperPanTemp}°C）で乾煎りして水分を飛ばしてから、` +
      `中強火で片面 ${Math.round(drySurfaceTimeSec * 1.5)} 秒焼く`;
    moistureTip =
      "水分が97%以上の食材（こんにゃく等）は先に乾煎りして表面水分を飛ばすと" +
      "メイラード反応が進みやすくなります。塩を一つまみ振ると浸透圧で脱水が促進されます。";
  } else if (waterFrac >= 0.70) {
    // 高水分（鶏むね肉・魚など）: 高温短時間
    heatLevelDescription =
      `中強火（${lowerPanTemp}〜${upperPanTemp}°C）で片面 ${Math.round(drySurfaceTimeSec * 1.2)} 秒焼く（全体加熱は別途）`;
    moistureTip =
      "焼く前にキッチンペーパーで表面水分を押さえることで蒸発エネルギーのロスを減らせます。";
  } else if (waterFrac >= 0.50) {
    // 中水分（豚・牛ロースなど）
    heatLevelDescription =
      `中強火（${lowerPanTemp}〜${upperPanTemp}°C）で片面 ${drySurfaceTimeSec} 秒焼く`;
    moistureTip = null;
  } else {
    // 低水分（チーズ・ナッツ・乾物など）: 焦げ注意で中火
    heatLevelDescription =
      `中火（${Math.max(140, lowerPanTemp - 20)}〜${lowerPanTemp}°C）で ` +
      `片面 ${Math.round(drySurfaceTimeSec * 0.7)} 秒（焦げやすいので注意）`;
    moistureTip = "低水分食材はメイラード反応より炭化が進みやすいため弱め火加減が安全です。";
  }

  // ── Step 4: メイラード反応スコア（0〜100） ──────────────────────────
  // タンパク質が多く、水分が少ないほどメイラード反応が起きやすい（理論値）
  // スコア = タンパク質寄与(0〜60) + 低水分寄与(0〜40)
  const proteinScore = Math.min(60, proteinFrac * 300); // タンパク20g/100g → 60点
  const dryScore = Math.max(0, 40 - waterFrac * 50);   // 水分80% → 0点、水分0% → 40点
  const maillardScore = Math.round(proteinScore + dryScore);

  // ── Step 5: 根拠テキスト ─────────────────────────────────────────────
  const computedCp = calcSpecificHeat(item);
  const rationale =
    `【物理計算の根拠】\n` +
    `• 比熱容量: Choi-Okos式で計算 → ${computedCp} J/(g·K)（AI推定: ${item.specificHeat} J/(g·K)）\n` +
    `• 表面水分蒸発エネルギー: ${surfaceWaterG.toFixed(4)}g × 2257J/g = ${evapHeatJ.toFixed(2)}J\n` +
    `• 強火時の熱フラックス: ${heatFluxWPerCm2.toFixed(2)} W/cm²\n` +
    `• 表面乾燥推定時間: ${drySurfaceTimeSec}秒\n` +
    `• メイラード反応スコア: タンパク質(${proteinFrac.toFixed(2)}) + 低水分(${(1-waterFrac).toFixed(2)}) → ${maillardScore}/100`;

  return {
    drySurfaceTimeSec,
    heatLevelDescription,
    targetPanTempRange: [lowerPanTemp, upperPanTemp],
    moistureTip,
    maillardScore,
    rationale,
  };
}

// ===========================
// パスタ乳化計算
// ===========================

export interface EmulsificationGuide {
  /** 推奨茹で汁量 [mL] */
  brothMl: number;
  /** 推奨バター量 [g] */
  butterG: number;
  /** 乳化のステップ説明 */
  steps: string[];
  /** パスタの茹で時間に基づく水分吸収量の推定 [g] */
  estimatedWaterAbsorptionG: number;
}

/**
 * パスタの乳化（Emulsification）に必要な水分量を計算し、手順を生成する。
 *
 * 乳化の科学:
 * - でん粉（パスタ由来）が界面活性剤として機能し O/W 型エマルションを形成
 * - バターのレシチンが安定剤として作用
 * - 茹で汁の塩分・でん粉濃度が乳化の安定性に寄与
 *
 * @param pastaWeightG - パスタの乾燥重量 [g]
 * @param cookingTimeSec - 茹で時間 [秒]。水分吸収量の推定に使用。
 * @returns EmulsificationGuide
 */
export function calcPastaEmulsification(
  pastaWeightG: number,
  cookingTimeSec: number
): EmulsificationGuide {
  // 茹で汁量: パスタ 100g 当たり最低 45mL（乳化安定には 60〜80mL が理想）
  const brothMl = Math.round(
    (pastaWeightG / 100) * EMULSIFICATION.minBrothPerPastaMl * 1.5
  );

  // バター量: O/W エマルションの転相に必要な界面活性剤（レシチン）の供給量
  const butterG = Math.round(
    (pastaWeightG / 100) * EMULSIFICATION.butterPerPastaG
  );

  // パスタの水分吸収量推定:
  // 茹でる間、パスタは初期重量の約 60〜80% の水分を吸収する（Fardet et al., 1998）
  // 茹で時間に比例すると近似（最大80%で飽和）
  const absorptionRate = Math.min(0.80, (cookingTimeSec / 480) * 0.75); // 8分で75%
  const estimatedWaterAbsorptionG = Math.round(pastaWeightG * absorptionRate);

  const steps = [
    `1. 沸騰したお湯に塩（水1Lに対し10g目安）を入れ、パスタを茹でる`,
    `2. 茹で上がり1分前に茹で汁を ${brothMl}mL 取り分けておく`,
    `3. フライパンにソースを弱火で温め、茹で汁を ${Math.round(brothMl * 0.6)}mL 加える`,
    `4. バター ${butterG}g を加えてフライパンを揺すりながら乳化させる（温度 65〜75°C を維持）`,
    `5. パスタを加え、残りの茹で汁 ${Math.round(brothMl * 0.4)}mL で調整しながら素早く混ぜる`,
    `6. 乳化できたらとろりとしたソースがパスタに絡まる（目安: 30〜45秒）`,
    `【推定値】パスタの水分吸収量: 約 ${estimatedWaterAbsorptionG}g（乾麺 ${pastaWeightG}g から茹で上がり約 ${pastaWeightG + estimatedWaterAbsorptionG}g）`,
  ];

  return { brothMl, butterG, steps, estimatedWaterAbsorptionG };
}

// ===========================
// 昇温予測（比熱を利用）
// ===========================

export interface HeatingPrediction {
  /** 目標温度到達までの推定時間 [秒] */
  timeToTargetSec: number;
  /** 中心温度が 75°C（食品安全基準）に達する推定時間 [秒] */
  timeTo75CSec: number;
  /** 推奨の休ませ時間（レスティング） [秒] */
  restTimeSec: number;
}

/**
 * 食材の中心温度上昇を比熱と熱伝達から予測する。
 *
 * 計算モデル（集中定数系近似 / Lumped Capacitance）:
 *   dT/dt ≈ (h × A / (m × c_p)) × (T_surface - T_center)
 *   h: 熱伝達係数 [W/(m²·K)]  A: 表面積 [m²]  m: 質量 [g]  c_p: 比熱 [J/(g·K)]
 *
 * ※ Bi数(= h×L/k) < 0.1 の場合のみ厳密に成立する近似。厚みのある食材（>30mm）では誤差が大きい。
 *
 * @param item - ScienceIngredient
 * @param targetTempC - 目標中心温度 [°C]
 * @param initialTempC - 初期温度（冷蔵: 5, 常温: 20, 冷凍: -18）[°C]
 * @param surfaceTempC - 加熱面温度（フライパン面） [°C]
 * @param thicknessMm - 食材の厚さ [mm]
 * @returns HeatingPrediction
 */
export function predictHeatingTime(
  item: ScienceIngredient,
  targetTempC: number,
  initialTempC: number,
  surfaceTempC: number,
  thicknessMm: number
): HeatingPrediction {
  const cp = calcSpecificHeat(item); // [J/(g·K)]

  // 対流熱伝達係数（フライパン接触面）の近似値 [W/(m²·K)]
  // 油を引いたパン面との接触: h ≈ 1000 W/(m²·K)（文献範囲: 500〜2000）
  const h = 1000;

  // 食材を正方形スラブと仮定: 厚さL [m]、面積A/mass = 2/(ρ×L) [m²/kg]
  // 密度 ρ ≈ 1050 g/L（肉類の平均値）
  const rhoGperL = 1050;
  const L = thicknessMm / 1000; // mm → m
  // 表面積 / 質量 の比 [m²/g]
  const SpecificAreaM2perG = 2 / (rhoGperL * L * 1000);

  // 時定数 τ = m×c_p / (h×A) = c_p / (h × A/m) [秒/単位]
  const tau = cp / (h * SpecificAreaM2perG); // [g·(J/(g·K))] / [W/(m²·K) × m²/g] = K·g/W × g = 秒

  // 指数関数的昇温モデル: T(t) = T_surface - (T_surface - T_0) × exp(-t/τ)
  // → t = -τ × ln((T_surface - T_target) / (T_surface - T_0))
  const deltaRatio = (surfaceTempC - targetTempC) / (surfaceTempC - initialTempC);
  const timeToTargetSec =
    deltaRatio > 0 && deltaRatio < 1
      ? Math.round(-tau * Math.log(deltaRatio))
      : 9999; // 到達不能

  const deltaRatio75 = (surfaceTempC - 75) / (surfaceTempC - initialTempC);
  const timeTo75CSec =
    deltaRatio75 > 0 && deltaRatio75 < 1
      ? Math.round(-tau * Math.log(deltaRatio75))
      : 9999;

  // レスティング（余熱）時間: 厚さに比例（薄切りは 30 秒、厚みがあるほど長く）
  const restTimeSec = Math.round(Math.min(300, Math.max(30, thicknessMm * 5)));

  return { timeToTargetSec, timeTo75CSec, restTimeSec };
}

// ===========================
// 調理アドバイス生成（統合ファサード）
// ===========================

export interface CookingAdvice {
  ingredientName: string;
  maillard: MaillardAnalysis;
  heating: HeatingPrediction;
  shelfLifeAlert: string | null;
  summary: string;
}

/**
 * ScienceIngredient から総合調理アドバイスを生成する。
 *
 * @param item - ScienceIngredient
 * @param thicknessMm - 食材の厚さ [mm]（省略時: カテゴリーで推定）
 * @returns CookingAdvice
 */
export function generateCookingAdvice(
  item: ScienceIngredient,
  thicknessMm?: number
): CookingAdvice {
  // カテゴリー別デフォルト厚さ推定
  const defaultThickness: Record<string, number> = {
    meat: 20, seafood: 15, vegetable: 10, egg: 40,
    dairy: 5, processed: 10, other: 15,
  };
  const thickness =
    thicknessMm ?? defaultThickness[item.category] ?? 15;

  const maillard = calculateOptimalSearing(item);

  // 冷蔵保存の食材は初期温度 5°C と仮定
  const initTemp =
    item.storageMethod === "frozen"
      ? -18
      : item.storageMethod === "refrigerated"
      ? 5
      : 20;

  const heating = predictHeatingTime(
    item,
    75, // 食品安全基準（食肉類は中心75°C 1秒以上）
    initTemp,
    maillard.targetPanTempRange[0], // 下限温度で計算（安全側）
    thickness
  );

  // 賞味期限アラート
  const shelfLifeAlert =
    item.shelfLifeDays <= 2
      ? `⚠️ ${item.name} は冷蔵 ${item.shelfLifeDays} 日以内に使い切ることを推奨（${item.shelfLifeReason}）`
      : null;

  const summary =
    `${item.name}（水分 ${item.waterContent}%, タンパク ${item.proteinContent}%）\n` +
    `→ メイラード反応スコア: ${maillard.maillardScore}/100\n` +
    `→ 推奨: ${maillard.heatLevelDescription}\n` +
    `→ 食品安全(75°C)到達: 厚さ ${thickness}mm で約 ${Math.round(heating.timeTo75CSec / 60)} 分\n` +
    `→ 比熱(計算値): ${calcSpecificHeat(item)} J/(g·K)`;

  return { ingredientName: item.name, maillard, heating, shelfLifeAlert, summary };
}
