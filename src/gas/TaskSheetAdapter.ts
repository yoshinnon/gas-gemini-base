/**
 * @file src/gas/TaskSheetAdapter.ts
 * @description スプレッドシートの読み書きアダプター。
 * Input シートからテキストを取得し、TaskBoard シートにタスクを書き出す。
 *
 * 責務（インフラ層）:
 * - GAS の SpreadsheetApp API を直接扱う唯一の場所
 * - ドメインモデル（Task）に依存するが、AIClient には依存しない
 */

import { Task, TaskPriority } from "../core/TaskExtractor";

// ===========================
// 定数
// ===========================

const SHEET_NAMES = {
  INPUT: "Input",
  TASK_BOARD: "TaskBoard",
} as const;

/** TaskBoard のヘッダー列定義（順序が列順と対応） */
const TASK_BOARD_HEADERS = [
  "ステータス",
  "期限",
  "担当者",
  "優先度",
  "タイトル",
  "内容",
  "元モデル",
  "登録日時",
] as const;

type TaskBoardHeader = (typeof TASK_BOARD_HEADERS)[number];

/** 列インデックス（0始まり）へのマッピング */
const COL: Record<TaskBoardHeader, number> = {
  ステータス: 0,
  期限: 1,
  担当者: 2,
  優先度: 3,
  タイトル: 4,
  内容: 5,
  元モデル: 6,
  登録日時: 7,
};

/** 優先度ごとの行背景色 */
const PRIORITY_COLORS: Record<TaskPriority, string> = {
  HIGH: "#fce8e6",   // 赤系
  MEDIUM: "#fef9e3", // 黄系
  LOW: "#e6f4ea",    // 緑系
};

// ===========================
// アダプタークラス
// ===========================

export class TaskSheetAdapter {
  // ===========================
  // Input シート: テキスト取得
  // ===========================

  /**
   * Input シートからテキストを取得する。
   * アクティブセルに内容があればそのセルのテキストを、
   * なければシート全体の非空セル内容を結合して返す。
   *
   * @returns 議事録テキスト
   * @throws Error - Input シートが存在しない場合
   */
  static getInputText(): string {
    const sheet = TaskSheetAdapter.requireSheet(SHEET_NAMES.INPUT);

    // アクティブセルの値を優先（選択範囲でのピンポイント解析に対応）
    const activeCell = sheet.getActiveCell();
    if (activeCell) {
      const cellValue = activeCell.getValue();
      if (typeof cellValue === "string" && cellValue.trim().length > 0) {
        return cellValue.trim();
      }
    }

    // シート全体のデータを取得
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();

    if (lastRow === 0 || lastCol === 0) {
      throw new Error(
        `"${SHEET_NAMES.INPUT}" シートにテキストが入力されていません。\n` +
          "議事録・会議メモを貼り付けてから再実行してください。"
      );
    }

    const values: string[][] = sheet
      .getRange(1, 1, lastRow, lastCol)
      .getValues() as string[][];

    // 全セルの文字列を改行で結合
    const text = values
      .flat()
      .filter((v) => v !== null && v !== undefined && String(v).trim() !== "")
      .map((v) => String(v).trim())
      .join("\n");

    if (!text) {
      throw new Error(
        `"${SHEET_NAMES.INPUT}" シートのセルがすべて空です。\n` +
          "議事録・会議メモを貼り付けてから再実行してください。"
      );
    }

    return text;
  }

  // ===========================
  // TaskBoard シート: タスク書き出し
  // ===========================

  /**
   * TaskBoard シートにタスクを追記する。
   * シートが存在しない場合は自動作成・ヘッダー設定を行う。
   *
   * @param tasks - 書き出すタスクの配列
   * @param modelUsed - 抽出に使用したモデル名（メタデータとして記録）
   * @returns 書き出した行数
   */
  static writeTasks(tasks: Task[], modelUsed: string): number {
    if (tasks.length === 0) return 0;

    const sheet = TaskSheetAdapter.getOrCreateTaskBoardSheet();
    const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

    // 全タスクを一括で appendRow（行ごとに色付け）
    tasks.forEach((task) => {
      const row = TaskSheetAdapter.taskToRow(task, modelUsed, now);
      const lastRow = sheet.getLastRow() + 1;
      sheet.appendRow(row);

      // 優先度に応じて行の背景色を設定
      const bgColor = PRIORITY_COLORS[task.priority];
      sheet
        .getRange(lastRow, 1, 1, TASK_BOARD_HEADERS.length)
        .setBackground(bgColor);
    });

    // 列幅の自動調整（書き出し後）
    sheet.autoResizeColumns(1, TASK_BOARD_HEADERS.length);

    return tasks.length;
  }

  /**
   * トースト通知をスプレッドシート右下に表示する。
   *
   * @param message - 表示メッセージ
   * @param title - トーストのタイトル
   * @param durationSeconds - 表示秒数（デフォルト: 5秒）
   */
  static showToast(
    message: string,
    title = "✅ 完了",
    durationSeconds = 5
  ): void {
    SpreadsheetApp.getActiveSpreadsheet().toast(message, title, durationSeconds);
  }

  /**
   * TaskBoard シートのタスク件数を返す（ヘッダー除く）。
   */
  static getTaskCount(): number {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.TASK_BOARD);
    if (!sheet) return 0;
    return Math.max(0, sheet.getLastRow() - 1);
  }

  // ===========================
  // プライベートヘルパー
  // ===========================

  /**
   * シートを取得する。存在しない場合は Error をスローする。
   */
  private static requireSheet(
    sheetName: string
  ): GoogleAppsScript.Spreadsheet.Sheet {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sheet) {
      throw new Error(
        `"${sheetName}" シートが見つかりません。\n` +
          `スプレッドシートに "${sheetName}" という名前のシートを作成してください。`
      );
    }
    return sheet;
  }

  /**
   * TaskBoard シートを取得または新規作成する。
   */
  private static getOrCreateTaskBoardSheet(): GoogleAppsScript.Spreadsheet.Sheet {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAMES.TASK_BOARD);

    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAMES.TASK_BOARD);
      TaskSheetAdapter.setupTaskBoardHeader(sheet);
    }

    return sheet;
  }

  /**
   * TaskBoard シートのヘッダー行を設定する。
   */
  private static setupTaskBoardHeader(
    sheet: GoogleAppsScript.Spreadsheet.Sheet
  ): void {
    const headerRange = sheet.getRange(
      1,
      1,
      1,
      TASK_BOARD_HEADERS.length
    );
    headerRange.setValues([Array.from(TASK_BOARD_HEADERS)]);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#1a237e"); // 濃紺
    headerRange.setFontColor("#ffffff");
    headerRange.setHorizontalAlignment("center");
    sheet.setFrozenRows(1);

    // ステータス列にデータバリデーション（ドロップダウン）を設定
    const statusRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(["未着手", "進行中", "完了", "保留"], true)
      .build();
    // B列以降（2行目から）にバリデーションを設定
    sheet
      .getRange(2, COL.ステータス + 1, sheet.getMaxRows() - 1, 1)
      .setDataValidation(statusRule);

    // 列幅の初期設定
    sheet.setColumnWidth(COL.ステータス + 1, 80);
    sheet.setColumnWidth(COL.期限 + 1, 90);
    sheet.setColumnWidth(COL.担当者 + 1, 100);
    sheet.setColumnWidth(COL.優先度 + 1, 70);
    sheet.setColumnWidth(COL.タイトル + 1, 200);
    sheet.setColumnWidth(COL.内容 + 1, 350);
    sheet.setColumnWidth(COL.元モデル + 1, 160);
    sheet.setColumnWidth(COL.登録日時 + 1, 140);
  }

  /**
   * Task オブジェクトをスプレッドシート行（配列）に変換する。
   */
  private static taskToRow(
    task: Task,
    modelUsed: string,
    registeredAt: string
  ): (string | number)[] {
    const row: (string | number)[] = new Array(TASK_BOARD_HEADERS.length).fill("");

    row[COL.ステータス] = "未着手";
    row[COL.期限] = task.dueDate || "未定";
    row[COL.担当者] = task.assignee || "未定";
    row[COL.優先度] = task.priority;
    row[COL.タイトル] = task.title;
    row[COL.内容] = task.description;
    row[COL.元モデル] = modelUsed;
    row[COL.登録日時] = registeredAt;

    return row;
  }
}
