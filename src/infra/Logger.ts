/**
 * @file Logger.ts
 * @description 実行ログをスプレッドシートに記録するロガー。
 * モデル名・消費トークン・ステータス・タイムスタンプを管理する。
 */

import { Config } from "./Config";

/** ログの1レコードを表す型 */
export interface LogRecord {
  timestamp: string;
  modelName: string;
  promptTokens: number | null;
  candidatesTokens: number | null;
  totalTokens: number | null;
  status: "SUCCESS" | "FALLBACK" | "ERROR";
  message: string;
}

/** Gemini API レスポンスのusageMetadataの型 */
export interface UsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

export class GasLogger {
  private static readonly HEADER_ROW: string[] = [
    "タイムスタンプ",
    "モデル名",
    "プロンプトトークン",
    "レスポンストークン",
    "合計トークン",
    "ステータス",
    "メッセージ",
  ];

  /**
   * ログをスプレッドシートに記録する。
   * シートが存在しない場合は自動作成し、ヘッダーを挿入する。
   */
  static log(record: LogRecord): void {
    try {
      const sheet = GasLogger.getOrCreateLogSheet();
      sheet.appendRow([
        record.timestamp,
        record.modelName,
        record.promptTokens ?? "N/A",
        record.candidatesTokens ?? "N/A",
        record.totalTokens ?? "N/A",
        record.status,
        record.message,
      ]);
    } catch (e) {
      // ロガー自体のエラーは console.error のみ（無限ループ防止）
      console.error("[GasLogger] ログ書き込みに失敗しました:", e);
    }
  }

  /**
   * 成功ログを記録する便利メソッド。
   */
  static logSuccess(
    modelName: string,
    usage: UsageMetadata,
    message = "API呼び出し成功"
  ): void {
    GasLogger.log({
      timestamp: new Date().toISOString(),
      modelName,
      promptTokens: usage.promptTokenCount ?? null,
      candidatesTokens: usage.candidatesTokenCount ?? null,
      totalTokens: usage.totalTokenCount ?? null,
      status: "SUCCESS",
      message,
    });
  }

  /**
   * フォールバック発生ログを記録する便利メソッド。
   */
  static logFallback(
    fromModel: string,
    toModel: string,
    reason: string
  ): void {
    GasLogger.log({
      timestamp: new Date().toISOString(),
      modelName: fromModel,
      promptTokens: null,
      candidatesTokens: null,
      totalTokens: null,
      status: "FALLBACK",
      message: `→ ${toModel} へフォールバック: ${reason}`,
    });
  }

  /**
   * エラーログを記録する便利メソッド。
   */
  static logError(modelName: string, error: string): void {
    GasLogger.log({
      timestamp: new Date().toISOString(),
      modelName,
      promptTokens: null,
      candidatesTokens: null,
      totalTokens: null,
      status: "ERROR",
      message: error,
    });
  }

  /**
   * ログシートを取得または新規作成する。
   */
  private static getOrCreateLogSheet(): GoogleAppsScript.Spreadsheet.Sheet {
    const sheetName = Config.getLogSheetName();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      // ヘッダー行を挿入し書式を設定
      const headerRange = sheet.getRange(1, 1, 1, GasLogger.HEADER_ROW.length);
      headerRange.setValues([GasLogger.HEADER_ROW]);
      headerRange.setFontWeight("bold");
      headerRange.setBackground("#4a4a8a");
      headerRange.setFontColor("#ffffff");
      sheet.setFrozenRows(1);
      // 列幅を自動調整
      sheet.autoResizeColumns(1, GasLogger.HEADER_ROW.length);
    }

    return sheet;
  }

  /**
   * ログシートの全レコード数を返す（ヘッダー除く）。
   * 診断用。
   */
  static getLogCount(): number {
    try {
      const sheetName = Config.getLogSheetName();
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(sheetName);
      if (!sheet) return 0;
      return Math.max(0, sheet.getLastRow() - 1); // ヘッダー行を除く
    } catch {
      return 0;
    }
  }
}
