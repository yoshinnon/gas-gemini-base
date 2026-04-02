/**
 * @file src/presentation/TaskMenu.ts
 * @description 「AI議事録解析」機能のメニュー UI。
 * ユースケース・シートアダプターを組み合わせてエンドツーエンドの処理を実行する。
 */

import { TaskUseCase } from "../core/TaskUseCase";
import { TaskSheetAdapter } from "../gas/TaskSheetAdapter";
import { ConfigError } from "../infra/Config";

// ===========================
// メニュー項目として GAS に公開する関数
// ===========================

/**
 * 「AI議事録解析実行」メニューのエントリポイント。
 * 確認ダイアログ → 入力取得 → AI抽出 → シート書き出し → トースト通知 の順に実行する。
 */
export function runTaskExtraction(): void {
  const ui = SpreadsheetApp.getUi();

  // --- Step 1: 実行確認ダイアログ ---
  const confirmation = ui.alert(
    "🤖 AI議事録解析",
    [
      "Input シートの議事録を解析し、タスクを抽出します。",
      "",
      "【処理の流れ】",
      "1. Input シートからテキストを読み取る",
      "2. Gemini AI でタスクを抽出（自動フォールバック対応）",
      "3. TaskBoard シートに抽出結果を追記する",
      "",
      "解析を開始しますか？",
    ].join("\n"),
    ui.ButtonSet.YES_NO
  );

  if (confirmation !== ui.Button.YES) {
    return; // キャンセル
  }

  // --- Step 2: 入力テキスト取得 ---
  let meetingText: string;
  try {
    meetingText = TaskSheetAdapter.getInputText();
  } catch (e) {
    ui.alert(
      "⚠️ 入力エラー",
      e instanceof Error ? e.message : String(e),
      ui.ButtonSet.OK
    );
    return;
  }

  // --- Step 3: 処理中通知（トースト）---
  SpreadsheetApp.getActiveSpreadsheet().toast(
    "Gemini AI がタスクを解析中です...",
    "⏳ 処理中",
    -1 // 手動クリアするまで表示
  );

  // --- Step 4: タスク抽出（ユースケース実行）---
  let extractionSucceeded = false;
  try {
    const useCase = new TaskUseCase();
    const output = useCase.extractTasks({ meetingText });

    // --- Step 5: TaskBoard に書き出し ---
    const writtenCount = TaskSheetAdapter.writeTasks(
      output.tasks,
      output.modelUsed
    );

    extractionSucceeded = true;

    // --- Step 6: 完了通知 ---
    const toastMessage = buildCompletionToastMessage(output.tasks.length, {
      modelUsed: output.modelUsed,
      fallbackCount: output.fallbackCount,
      parseRetryCount: output.parseRetryCount,
      totalTokens: output.totalTokens,
    });

    TaskSheetAdapter.showToast(toastMessage, "✅ 解析完了", 8);

    // 詳細サマリーダイアログ
    ui.alert(
      "✅ AI議事録解析 完了",
      buildCompletionDialogMessage(output, writtenCount),
      ui.ButtonSet.OK
    );
  } catch (e) {
    // 処理中トーストを消す（空白トーストで上書き）
    if (!extractionSucceeded) {
      SpreadsheetApp.getActiveSpreadsheet().toast("", "", 1);
    }

    const errorMessage = buildErrorMessage(e);
    ui.alert("❌ 解析エラー", errorMessage, ui.ButtonSet.OK);
  }
}

/**
 * TaskBoard シートの状況を確認するメニュー項目。
 */
export function showTaskBoardStatus(): void {
  const ui = SpreadsheetApp.getUi();
  const count = TaskSheetAdapter.getTaskCount();

  ui.alert(
    "📋 TaskBoard ステータス",
    `現在の登録タスク数: ${count} 件\n\n` +
      "TaskBoard シートでタスクのステータスを「未着手 / 進行中 / 完了 / 保留」に更新できます。",
    ui.ButtonSet.OK
  );
}

// ===========================
// メッセージビルダー（プレゼンテーション層の責務）
// ===========================

interface CompletionMeta {
  modelUsed: string;
  fallbackCount: number;
  parseRetryCount: number;
  totalTokens: number | null;
}

/** トースト通知メッセージを組み立てる */
function buildCompletionToastMessage(
  taskCount: number,
  meta: CompletionMeta
): string {
  const parts = [`${taskCount} 件のタスクを TaskBoard に追加しました。`];

  if (meta.fallbackCount > 0) {
    parts.push(`（${meta.fallbackCount} 回フォールバック）`);
  }

  return parts.join(" ");
}

/** 完了ダイアログのメッセージを組み立てる */
function buildCompletionDialogMessage(
  output: ReturnType<TaskUseCase["extractTasks"]>,
  writtenCount: number
): string {
  const lines: string[] = [
    `📊 抽出タスク数: ${writtenCount} 件`,
    `📡 使用モデル: ${output.modelUsed}`,
  ];

  if (output.fallbackCount > 0) {
    lines.push(`⚠️ フォールバック: ${output.fallbackCount} 回発生`);
  } else {
    lines.push("✅ フォールバック: なし（最優先モデルで成功）");
  }

  if (output.parseRetryCount > 0) {
    lines.push(`🔄 パースリトライ: ${output.parseRetryCount} 回`);
  }

  if (output.totalTokens !== null) {
    lines.push(`🔢 消費トークン: ${output.totalTokens.toLocaleString()} tokens`);
  }

  if (output.summary) {
    lines.push("", "📝 会議サマリー:", output.summary);
  }

  lines.push("", "TaskBoard シートで抽出結果を確認してください。");

  return lines.join("\n");
}

/** エラーメッセージを種別に応じて組み立てる */
function buildErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);

  // APIキー未設定
  if (e instanceof ConfigError || raw.includes("APIキーが設定されていません")) {
    return [
      "Gemini API キーが設定されていません。",
      "",
      "設定方法: メニュー「🤖 Gemini AI」>「⚙️ APIキーを設定する」をご確認ください。",
    ].join("\n");
  }

  // 全モデル失敗（レートリミット等）
  if (raw.includes("全てのモデルでAPI呼び出しに失敗しました")) {
    return [
      "全てのモデルでAPI呼び出しに失敗しました。",
      "",
      "考えられる原因:",
      "• 無料枠のレートリミット（429）に全モデルが抵触している",
      "• ネットワーク接続の問題",
      "• Gemini API サービスの一時障害",
      "",
      "しばらく待ってから再実行してください。",
      "",
      "エラー詳細:",
      raw.slice(0, 300),
    ].join("\n");
  }

  // Input シートなし / テキスト空
  if (raw.includes("シートが見つかりません") || raw.includes("テキストが入力されていません")) {
    return raw;
  }

  // その他
  return ["予期しないエラーが発生しました。", "", raw.slice(0, 400)].join("\n");
}
