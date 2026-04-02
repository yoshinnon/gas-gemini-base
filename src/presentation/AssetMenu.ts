/**
 * @file src/presentation/AssetMenu.ts
 * @description 「資産データ解析・更新」機能のメニュー UI。
 * 実行中モデル名をステータスバーに表示しながらポートフォリオを更新する。
 */

import { AssetUseCase } from "../core/AssetUseCase";
import { AssetRepository } from "../gas/AssetRepository";
import { ConfigError } from "../infra/Config";

// ===========================
// GAS グローバル関数
// ===========================

/**
 * 「資産データ解析・更新」メニューのエントリポイント。
 */
export function runAssetAnalysis(): void {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // --- Step 1: 実行確認ダイアログ ---
  const confirm = ui.alert(
    "💰 資産データ解析・更新",
    [
      "AssetInput シートのテキストを解析し、ポートフォリオを更新します。",
      "",
      "【処理の流れ】",
      "1. AssetInput シートから金融テキストを読み取る",
      "2. Gemini AI で資産（名称・数量・通貨）を抽出",
      "3. 為替・暗号資産レートを外部 API から取得（自動フォールバック）",
      "4. Portfolio シートを差分更新（手動編集値は保持）",
      "5. History シートにスナップショットを記録",
      "",
      "⚠️ セキュリティ注意: 銀行パスワード・秘密鍵を入力しないでください。",
      "",
      "解析を開始しますか？",
    ].join("\n"),
    ui.ButtonSet.YES_NO
  );

  if (confirm !== ui.Button.YES) return;

  // --- Step 2: 入力テキスト取得 ---
  let rawText: string;
  try {
    rawText = AssetRepository.getInputText();
  } catch (e) {
    ui.alert(
      "⚠️ 入力エラー",
      e instanceof Error ? e.message : String(e),
      ui.ButtonSet.OK
    );
    return;
  }

  // --- Step 3: ステータスバーで進捗表示 ---
  ss.toast("AI が資産テキストを解析中です...", "⏳ Step 1/4: AI解析", -1);

  let analysisSucceeded = false;
  try {
    const useCase = new AssetUseCase();
    const output = useCase.analyzeAssets(rawText);

    // モデル使用情報をステータスバーに反映
    ss.toast(
      `${output.modelUsed} で解析完了（${output.portfolioItems.length}件）\nレート取得中...`,
      "⏳ Step 2/4: レート取得",
      -1
    );

    // --- Step 4: Portfolio 差分更新 ---
    ss.toast("Portfolio シートを更新中...", "⏳ Step 3/4: シート更新", -1);
    const { added, updated } = AssetRepository.upsertPortfolio(output.portfolioItems);

    // --- Step 5: History 追記 ---
    ss.toast("履歴を記録中...", "⏳ Step 4/4: 履歴記録", -1);
    AssetRepository.appendHistory(
      output.totalJpy,
      output.portfolioItems.length,
      output.modelUsed,
      output.hasAiEstimateRates,
      output.sourceSummary.slice(0, 100)
    );

    // グラフを更新
    AssetRepository.refreshHistoryChart();

    analysisSucceeded = true;

    // --- Step 6: 完了通知 ---
    AssetRepository.showToast(
      `${added}件追加 / ${updated}件更新 / 合計 ¥${output.totalJpy.toLocaleString()}`,
      "✅ 解析完了",
      8
    );

    // 完了ダイアログ
    ui.alert(
      "✅ 資産データ解析 完了",
      buildCompletionMessage(output, added, updated),
      ui.ButtonSet.OK
    );
  } catch (e) {
    if (!analysisSucceeded) {
      ss.toast("", "", 1); // 処理中トーストを消去
    }
    ui.alert(
      "❌ 解析エラー",
      buildErrorMessage(e),
      ui.ButtonSet.OK
    );
  }
}

/**
 * ポートフォリオの現在状況をサマリー表示する。
 */
export function showPortfolioSummary(): void {
  const ui = SpreadsheetApp.getUi();
  const portfolioCount = AssetRepository.getPortfolioCount();
  const historyCount = AssetRepository.getHistoryCount();

  ui.alert(
    "📊 ポートフォリオ状況",
    [
      `登録資産数: ${portfolioCount} 件`,
      `履歴記録数: ${historyCount} 回`,
      "",
      "Portfolio シート: 各資産の詳細・JPY換算額",
      "History シート: 資産合計の推移グラフ",
      "",
      "ステータス列（保有中/売却済み/確認中/除外）は自由に編集できます。",
    ].join("\n"),
    ui.ButtonSet.OK
  );
}

// ===========================
// メッセージビルダー
// ===========================

type AnalysisOutput = ReturnType<AssetUseCase["analyzeAssets"]>;

function buildCompletionMessage(
  output: AnalysisOutput,
  added: number,
  updated: number
): string {
  const lines: string[] = [
    `💰 合計資産額: ¥${output.totalJpy.toLocaleString()}`,
    `📦 資産件数: ${output.portfolioItems.length} 件（新規: ${added} / 更新: ${updated}）`,
    `📡 使用モデル: ${output.modelUsed}`,
  ];

  if (output.fallbackCount > 0) {
    lines.push(`⚠️  フォールバック: ${output.fallbackCount} 回発生`);
  }

  if (output.parseRetryCount > 0) {
    lines.push(`🔄 パースリトライ: ${output.parseRetryCount} 回`);
  }

  if (output.totalTokens !== null) {
    lines.push(`🔢 消費トークン: ${output.totalTokens.toLocaleString()} tokens`);
  }

  if (output.hasAiEstimateRates) {
    lines.push(
      "",
      "⚠️ 注意: 一部の為替レートは AI による推定値です。",
      "投資判断には公式レートをご確認ください。"
    );
  }

  if (output.warnings.length > 0) {
    lines.push("", "📋 解析上の注意点:");
    output.warnings.forEach((w) => lines.push(`  • ${w}`));
  }

  if (output.sourceSummary) {
    lines.push("", "📝 入力データ概要:", output.sourceSummary);
  }

  return lines.join("\n");
}

function buildErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);

  if (e instanceof ConfigError || raw.includes("APIキーが設定されていません")) {
    return [
      "Gemini API キーが設定されていません。",
      "",
      "設定方法: メニュー「🤖 Gemini AI」>「⚙️ APIキーを設定する」をご確認ください。",
    ].join("\n");
  }

  if (raw.includes("全てのモデルでAPI呼び出しに失敗しました")) {
    return [
      "全てのモデルでAPI呼び出しに失敗しました。",
      "",
      "考えられる原因:",
      "• 無料枠のレートリミット（429）に全モデルが抵触",
      "• Gemini API サービスの一時障害",
      "",
      "しばらく待ってから再実行してください。",
      "",
      raw.slice(0, 300),
    ].join("\n");
  }

  if (raw.includes("シートが見つかりません") || raw.includes("テキストが入力されていません")) {
    return raw;
  }

  return ["予期しないエラーが発生しました。", "", raw.slice(0, 400)].join("\n");
}
