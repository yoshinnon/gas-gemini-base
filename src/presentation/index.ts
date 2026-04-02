/**
 * @file presentation/index.ts
 * @description スプレッドシートのメニューUI実装。
 * システム診断・アクティブモデル確認などのユーザー向け機能を提供する。
 */

import { AIClient, MODEL_PRIORITY, GenerateContentResult } from "../infra/AIClient";
import { Config, ConfigError } from "../infra/Config";
import { GasLogger } from "../infra/Logger";

// ===========================
// メニュー定義
// ===========================

/**
 * スプレッドシート起動時に自動実行されるトリガー関数。
 * カスタムメニューを追加する。
 * GAS の onOpen トリガーとして登録が必要。
 */
export function onOpen(): void {
  SpreadsheetApp.getActiveSpreadsheet()
    .addMenu("🤖 Gemini AI", [
      // --- キッチン・在庫管理 ---
      {
        name: "🛒 購入品をスキャンして在庫更新",
        functionName: "runGroceryScan",
      },
      {
        name: "🔬 科学的調理アドバイスを表示",
        functionName: "showCookingAdvicePopup",
      },
      {
        name: "🐱 猫の在庫状況を確認",
        functionName: "showCatInventoryAlert",
      },
      {
        name: "🍝 パスタ乳化ガイド",
        functionName: "showPastaEmulsificationGuide",
      },
      null, // セパレーター
      // --- 資産解析 ---
      {
        name: "💰 資産データ解析・更新",
        functionName: "runAssetAnalysis",
      },
      {
        name: "📊 ポートフォリオ状況を確認",
        functionName: "showPortfolioSummary",
      },
      null, // セパレーター
      // --- 議事録解析 ---
      {
        name: "📝 AI議事録解析を実行",
        functionName: "runTaskExtraction",
      },
      {
        name: "📋 TaskBoard の状況を確認",
        functionName: "showTaskBoardStatus",
      },
      null, // セパレーター
      // --- システム管理 ---
      {
        name: "🔍 システム診断（API接続テスト）",
        functionName: "runDiagnostics",
      },
      {
        name: "📊 アクティブモデルを確認",
        functionName: "showActiveModel",
      },
      { name: "🗒️ ログシートを開く", functionName: "openLogSheet" },
      null, // セパレーター
      {
        name: "⚙️ APIキーを設定する",
        functionName: "promptApiKeySetup",
      },
    ]);
}

// ===========================
// メニュー実行関数
// ===========================

/**
 * システム診断を実行する。
 * API接続テストを行い、結果をダイアログで表示する。
 */
export function runDiagnostics(): void {
  const ui = SpreadsheetApp.getUi();

  const diagResult = performDiagnostics();

  const icon = diagResult.success
    ? SpreadsheetApp.getUi().ButtonSet.OK
    : SpreadsheetApp.getUi().ButtonSet.OK;

  const title = diagResult.success
    ? "✅ 診断完了 - 正常"
    : "❌ 診断完了 - エラー検出";

  ui.alert(title, diagResult.report, icon);
}

/**
 * 現在アクティブなモデル（利用可能な最優先モデル）を表示する。
 * 簡易疎通確認（ドライラン）でモデルの順序を確認する。
 */
export function showActiveModel(): void {
  const ui = SpreadsheetApp.getUi();

  try {
    Config.getGeminiApiKey(); // APIキー確認
  } catch (e) {
    if (e instanceof ConfigError) {
      ui.alert("⚠️ APIキー未設定", e.message, ui.ButtonSet.OK);
      return;
    }
  }

  const lines: string[] = ["📋 モデル優先順位リスト:\n"];
  MODEL_PRIORITY.forEach((model, index) => {
    const priority = index === 0 ? "⭐ 最優先" : `  ${index + 1}番目`;
    lines.push(`${priority}: ${model}`);
  });

  lines.push("\n※ 最優先モデルから順に試行し、失敗した場合に次へフォールバックします。");
  lines.push(`※ 現在のログ件数: ${GasLogger.getLogCount()} 件`);

  ui.alert("📊 モデル設定情報", lines.join("\n"), ui.ButtonSet.OK);
}

/**
 * ログシートをアクティブにする。
 */
export function openLogSheet(): void {
  const ui = SpreadsheetApp.getUi();
  const sheetName = Config.getLogSheetName();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    ui.alert(
      "ℹ️ ログシートなし",
      `"${sheetName}" シートはまだ作成されていません。\nAPI を呼び出すと自動作成されます。`,
      ui.ButtonSet.OK
    );
    return;
  }

  ss.setActiveSheet(sheet);
}

/**
 * APIキーの設定を促すダイアログを表示する。
 */
export function promptApiKeySetup(): void {
  const ui = SpreadsheetApp.getUi();
  const instructions = [
    "Gemini API キーの設定方法:",
    "",
    "1. GAS エディタを開く（拡張機能 > Apps Script）",
    "2. 「プロジェクトの設定」(⚙️) をクリック",
    "3. 「スクリプトプロパティ」セクションで以下を追加:",
    "",
    "   プロパティ名: GEMINI_API_KEY",
    "   値: あなたのAPIキー",
    "",
    "4. APIキーの取得先:",
    "   https://aistudio.google.com/app/apikey",
    "",
    "【任意】ログシート名の変更:",
    "   プロパティ名: LOG_SHEET_NAME",
    "   値: お好みのシート名 (デフォルト: AI_Log)",
  ].join("\n");

  ui.alert("⚙️ APIキー設定ガイド", instructions, ui.ButtonSet.OK);
}

// ===========================
// 診断ロジック
// ===========================

interface DiagnosticsResult {
  success: boolean;
  report: string;
}

/**
 * 診断処理の実体。テスト可能なよう ui から分離。
 */
function performDiagnostics(): DiagnosticsResult {
  const lines: string[] = ["=== Gemini API システム診断 ===\n"];
  const startTime = new Date();

  // 1. APIキー確認
  lines.push("【1/3】 APIキー確認...");
  let apiKeyOk = false;
  try {
    Config.getGeminiApiKey();
    apiKeyOk = true;
    lines.push("  ✅ APIキー: 設定済み\n");
  } catch (e) {
    lines.push(
      `  ❌ APIキー: 未設定\n  → ${e instanceof Error ? e.message : String(e)}\n`
    );
    lines.push("\n診断を中断しました。先にAPIキーを設定してください。");
    return { success: false, report: lines.join("\n") };
  }

  // 2. API接続テスト（テストプロンプトで実際に呼び出す）
  lines.push("【2/3】 API接続テスト...");
  let connectionResult: GenerateContentResult | null = null;
  let connectionError = "";

  try {
    const client = new AIClient();
    connectionResult = client.generateContent(
      '「接続テスト成功」とだけ日本語で応答してください。',
      "あなたはシステム診断アシスタントです。簡潔に応答してください。",
      { maxOutputTokens: 50, temperature: 0 }
    );

    lines.push(`  ✅ API接続: 成功`);
    lines.push(`  📡 使用モデル: ${connectionResult.modelUsed}`);
    if (connectionResult.fallbackCount > 0) {
      lines.push(`  ⚠️  フォールバック回数: ${connectionResult.fallbackCount} 回`);
    }
    lines.push(`  💬 応答: "${connectionResult.text.trim()}"\n`);
  } catch (e) {
    connectionError = e instanceof Error ? e.message : String(e);
    lines.push(`  ❌ API接続: 失敗\n  → ${connectionError}\n`);
  }

  // 3. ログ機能確認
  lines.push("【3/3】 ログ機能確認...");
  try {
    const logCount = GasLogger.getLogCount();
    lines.push(`  ✅ ログシート: 正常 (記録件数: ${logCount} 件)\n`);
  } catch (e) {
    lines.push(
      `  ⚠️ ログシート: ${e instanceof Error ? e.message : String(e)}\n`
    );
  }

  // 診断サマリー
  const elapsed = new Date().getTime() - startTime.getTime();
  const success = apiKeyOk && connectionResult !== null;

  lines.push("=".repeat(30));
  lines.push(
    success
      ? `✅ 診断結果: 正常 (${elapsed}ms)`
      : `❌ 診断結果: エラーあり (${elapsed}ms)`
  );

  if (connectionResult) {
    const usage = connectionResult.usageMetadata;
    if (usage.totalTokenCount) {
      lines.push(`📊 テストトークン消費: ${usage.totalTokenCount} tokens`);
    }
  }

  return { success, report: lines.join("\n") };
}
