/**
 * @file src/presentation/KitchenMenu.ts
 * @description 「キッチン・猫在庫管理」機能のメニュー UI。
 *
 * 提供機能:
 * 1. 購入品をスキャンして在庫更新（GroceryInput → Inventory）
 * 2. 科学的調理アドバイスをポップアップ表示（CookingDashboard）
 * 3. 猫用品の在庫確認・アラート表示
 */

import { KitchenUseCase } from "../core/KitchenUseCase";
import { KitchenRepository } from "../gas/KitchenRepository";
import {
  StockStatus,
  buildInventorySummary,
  createStockStatus,
  DEFAULT_DAILY_CONSUMPTION,
} from "../core/CatInventory";
import { calcPastaEmulsification } from "../core/CookingAdvisor";
import { ConfigError } from "../infra/Config";

// ===========================
// GAS グローバル関数（メニュー項目）
// ===========================

/**
 * 「購入品をスキャンして在庫更新」のエントリポイント。
 * GroceryInput のテキストを解析し、Inventory と CookingDashboard を更新する。
 */
export function runGroceryScan(): void {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // --- Step 1: 確認ダイアログ ---
  const confirm = ui.alert(
    "🛒 購入品スキャン・在庫更新",
    [
      "GroceryInput シートのテキストを解析します。",
      "",
      "【処理の流れ】",
      "1. GroceryInput からレシート・購入品リストを読み取る",
      "2. Gemini AI が食材名・重量・価格・物理特性を抽出",
      "   （優先: gemini-3-flash → 自動フォールバック）",
      "3. TypeScript 側でメイラード反応・昇温予測などを計算",
      "4. Inventory シートを差分更新",
      "5. CookingDashboard に科学的調理アドバイスを表示",
      "",
      "解析を開始しますか？",
    ].join("\n"),
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  // --- Step 2: 入力取得 ---
  let rawText: string;
  try {
    rawText = KitchenRepository.getGroceryInputText();
  } catch (e) {
    ui.alert("⚠️ 入力エラー", e instanceof Error ? e.message : String(e), ui.ButtonSet.OK);
    return;
  }

  // --- Step 3: 処理中ステータスバー ---
  ss.toast(
    "Gemini AI が食材を解析中...",
    "⏳ Step 1/4: AI解析（使用モデルを自動選択）",
    -1
  );

  let succeeded = false;
  try {
    const useCase = new KitchenUseCase();
    const output = useCase.scanGrocery(rawText);

    // ステータスバーでモデル名を表示
    ss.toast(
      `${output.modelUsed} で解析完了（${output.ingredients.length}件）`,
      `⏳ Step 2/4: Inventory 更新`,
      -1
    );

    // --- Step 4: Inventory 差分更新 ---
    const { added, updated } = KitchenRepository.upsertIngredients(
      output.ingredients,
      output.modelUsed
    );

    ss.toast(
      `Inventory: ${added}件追加 / ${updated}件更新`,
      "⏳ Step 3/4: CookingDashboard 生成",
      -1
    );

    // --- Step 5: CookingDashboard 書き出し ---
    KitchenRepository.writeCookingDashboard(output.cookingAdvices);

    succeeded = true;

    // --- Step 6: 完了通知 ---
    KitchenRepository.showToast(
      `${output.ingredients.length}品目を解析完了 | モデル: ${output.modelUsed}`,
      "✅ スキャン完了",
      8
    );

    // 完了ダイアログ（調理アドバイスのハイライト付き）
    ui.alert(
      "✅ 購入品スキャン完了",
      buildScanCompletionMessage(output, added, updated),
      ui.ButtonSet.OK
    );
  } catch (e) {
    if (!succeeded) ss.toast("", "", 1);
    ui.alert("❌ スキャンエラー", buildErrorMessage(e), ui.ButtonSet.OK);
  }
}

/**
 * 「科学的調理アドバイスをポップアップ表示」ボタン用関数。
 * CookingDashboard の内容をサマリーダイアログで表示する。
 */
export function showCookingAdvicePopup(): void {
  const ui = SpreadsheetApp.getUi();

  // CookingDashboard シートを確認
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dashSheet = ss.getSheetByName("CookingDashboard");

  if (!dashSheet || dashSheet.getLastRow() < 3) {
    ui.alert(
      "ℹ️ ダッシュボード未生成",
      "まず「購入品をスキャンして在庫更新」を実行してください。",
      ui.ButtonSet.OK
    );
    return;
  }

  // 3行目以降（ヘッダー2行の後）からデータ取得
  const lastRow = dashSheet.getLastRow();
  const data = dashSheet
    .getRange(3, 1, lastRow - 2, 5)
    .getValues() as string[][];

  const lines = ["📊 本日の科学的調理アドバイス", ""];
  data.forEach((row) => {
    const [name, , , score, method] = row;
    if (name && String(name).trim()) {
      lines.push(`🍳 ${name}`);
      lines.push(`   メイラードスコア: ${score}/100`);
      lines.push(`   ${method}`);
      lines.push("");
    }
  });

  lines.push("詳細は CookingDashboard シートをご確認ください。");
  ui.alert("🔬 科学的調理アドバイス", lines.join("\n"), ui.ButtonSet.OK);
}

/**
 * 「猫の在庫状況を確認」メニュー項目。
 * Inventory シートから猫用品データを読み取り、アラートを表示する。
 */
export function showCatInventoryAlert(): void {
  const ui = SpreadsheetApp.getUi();

  // デモ用の在庫データ（実際は Inventory シートから読み取る）
  // ※ 本番実装では KitchenRepository にリードバック機能を追加すること
  const demoSupplies: StockStatus[] = [
    createStockStatus({
      id: "litter_main",
      name: "猫砂（システムトイレ用チップ）",
      category: "litter",
      currentAmount: 800,
      unit: "g",
      dailyConsumption: DEFAULT_DAILY_CONSUMPTION.litter.amount,
      consumptionVariability: 0.3,
    }),
    createStockStatus({
      id: "dry_food_main",
      name: "ドライフード（成猫用）",
      category: "dryFood",
      currentAmount: 120,
      unit: "g",
      dailyConsumption: DEFAULT_DAILY_CONSUMPTION.dryFood.amount,
      consumptionVariability: 0.2,
    }),
  ];

  const summary = buildInventorySummary(demoSupplies);

  const lines: string[] = ["🐱 猫用品 在庫アラート", ""];

  if (summary.emptyItems.length > 0) {
    lines.push("🔴 在庫切れ（今すぐ購入が必要）:");
    summary.emptyItems.forEach((i) => lines.push(`  • ${i.name}`));
    lines.push("");
  }

  if (summary.criticalItems.length > 0) {
    lines.push("🟠 緊急補充（3日以内に購入を）:");
    summary.criticalItems.forEach((i) =>
      lines.push(`  • ${i.name}（残り ${i.remainingDays} 日）`)
    );
    lines.push("");
  }

  if (summary.warningItems.length > 0) {
    lines.push("🟡 要注意（今週中に購入を）:");
    summary.warningItems.forEach((i) =>
      lines.push(`  • ${i.name}（残り ${i.remainingDays} 日）`)
    );
    lines.push("");
  }

  if (summary.okItems.length > 0) {
    lines.push("🟢 余裕あり:");
    summary.okItems.forEach((i) =>
      lines.push(`  • ${i.name}（残り ${i.remainingDays} 日）`)
    );
  }

  if (summary.nextShoppingList.length > 0) {
    lines.push("", "📋 推奨購入リスト:");
    summary.nextShoppingList.forEach((s) =>
      lines.push(
        `  • ${s.name}: ${s.amount}${s.unit}（${
          s.urgency === "urgent" ? "⚠️ 急ぎ" : "近日中"
        }）`
      )
    );
  }

  // ダッシュボードにも在庫サマリーを追記
  try {
    KitchenRepository.writeCatInventorySummary(summary);
  } catch {
    // CookingDashboard が未作成の場合はスキップ
  }

  ui.alert("🐱 猫用品 在庫状況", lines.join("\n"), ui.ButtonSet.OK);
}

/**
 * 「パスタ乳化ガイド」計算ツール。
 * パスタ重量を入力するだけで乳化手順を表示する。
 */
export function showPastaEmulsificationGuide(): void {
  const ui = SpreadsheetApp.getUi();

  const response = ui.prompt(
    "🍝 パスタ乳化ガイド",
    "パスタの乾燥重量 [g] を入力してください（例: 100）:",
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) return;

  const input = response.getResponseText().trim();
  const weightG = parseFloat(input);

  if (isNaN(weightG) || weightG <= 0) {
    ui.alert("⚠️ 入力エラー", "正の数値を入力してください。", ui.ButtonSet.OK);
    return;
  }

  // 茹で時間の入力
  const timeResponse = ui.prompt(
    "🍝 パスタ乳化ガイド",
    "茹で時間 [分] を入力してください（例: 8）:",
    ui.ButtonSet.OK_CANCEL
  );

  if (timeResponse.getSelectedButton() !== ui.Button.OK) return;

  const cookingTimeSec = (parseFloat(timeResponse.getResponseText().trim()) || 8) * 60;
  const guide = calcPastaEmulsification(weightG, cookingTimeSec);

  const lines = [
    `🍝 パスタ ${weightG}g の乳化ガイド（Emulsification）`,
    "",
    `推奨茹で汁量: ${guide.brothMl} mL`,
    `推奨バター量: ${guide.butterG} g`,
    `推定水分吸収量: 約 ${guide.estimatedWaterAbsorptionG}g（乾麺 → 茹で上がり約 ${Math.round(weightG + guide.estimatedWaterAbsorptionG)}g）`,
    "",
    "【手順】",
    ...guide.steps,
    "",
    "※ この計算は食品科学の理論値に基づく推定です。",
  ];

  ui.alert("🍝 パスタ乳化ガイド", lines.join("\n"), ui.ButtonSet.OK);
}

// ===========================
// メッセージビルダー
// ===========================

type ScanOutput = ReturnType<KitchenUseCase["scanGrocery"]>;

function buildScanCompletionMessage(
  output: ScanOutput,
  added: number,
  updated: number
): string {
  const lines: string[] = [
    `📦 解析食材数: ${output.ingredients.length} 品目（新規: ${added} / 更新: ${updated}）`,
    `📡 使用モデル: ${output.modelUsed}`,
  ];

  if (output.fallbackCount > 0) {
    lines.push(`⚠️ フォールバック: ${output.fallbackCount} 回`);
  }
  if (output.parseRetryCount > 0) {
    lines.push(`🔄 パースリトライ: ${output.parseRetryCount} 回`);
  }
  if (output.totalTokens !== null) {
    lines.push(`🔢 消費トークン: ${output.totalTokens.toLocaleString()} tokens`);
  }

  // 調理アドバイスのハイライト（メイラードスコア上位3件）
  const topAdvices = [...output.cookingAdvices]
    .sort((a, b) => b.maillard.maillardScore - a.maillard.maillardScore)
    .slice(0, 3);

  if (topAdvices.length > 0) {
    lines.push("", "🔬 メイラード反応スコア TOP 3:");
    topAdvices.forEach((a) => {
      lines.push(
        `  ${a.maillard.maillardScore}/100  ${a.ingredientName}` +
          (a.shelfLifeAlert ? "  ⚠️ 要注意" : "")
      );
    });
  }

  // 賞味期限アラート
  const alerts = output.cookingAdvices
    .map((a) => a.shelfLifeAlert)
    .filter(Boolean);
  if (alerts.length > 0) {
    lines.push("", "⚠️ 賞味期限アラート:");
    alerts.forEach((a) => lines.push(`  ${a}`));
  }

  if (output.warnings.length > 0) {
    lines.push("", "📋 解析上の注意:");
    output.warnings.slice(0, 3).forEach((w) => lines.push(`  • ${w}`));
  }

  lines.push("", "CookingDashboard シートで詳細を確認できます。");
  return lines.join("\n");
}

function buildErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);

  if (e instanceof ConfigError || raw.includes("APIキーが設定されていません")) {
    return "Gemini API キーが設定されていません。\n\nメニュー「⚙️ APIキーを設定する」をご確認ください。";
  }

  if (raw.includes("全てのモデルでAPI呼び出しに失敗しました")) {
    return [
      "全てのモデルでAPI呼び出しに失敗しました。",
      "",
      "• レートリミット（429）に全モデルが抵触している可能性",
      "• しばらく待ってから再実行してください",
      "",
      raw.slice(0, 300),
    ].join("\n");
  }

  if (raw.includes("シートが見つかりません") || raw.includes("テキストが入力されていません")) {
    return raw;
  }

  return ["予期しないエラーが発生しました。", "", raw.slice(0, 400)].join("\n");
}
