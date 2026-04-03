/**
 * @file src/gas/AssetRepository.ts
 * @description ポートフォリオ関連のスプレッドシート読み書きリポジトリ。
 *
 * 管理シート:
 * - AssetInput  : 自由なテキスト貼り付け（ユーザーが手動で入力）
 * - Portfolio   : AI抽出済みの資産テーブル（差分更新）
 * - History     : 日次の資産合計記録（追記のみ）
 *
 * 設計上の安全性:
 * - Portfolio はユーザーが手動編集した「ステータス」「メモ」列を上書きしない
 * - identifier をキーとした差分更新（新規: 追加、既存: 数値列のみ更新）
 */

import { AssetCategory } from "../core/AssetParser";
import { PortfolioItem } from "../core/AssetUseCase";

// ===========================
// シート名定数
// ===========================

const SHEET_NAMES = {
  ASSET_INPUT: "AssetInput",
  PORTFOLIO: "Portfolio",
  HISTORY: "History",
} as const;

// ===========================
// Portfolio シートの列定義
// ===========================

const PORTFOLIO_HEADERS = [
  "identifier",      // A: 差分更新キー（非表示推奨）
  "カテゴリー",       // B
  "資産名",          // C
  "数量",            // D
  "通貨",            // E
  "レート(JPY)",     // F
  "JPY換算額",       // G
  "取得モデル",       // H
  "レートソース",     // I
  "推定フラグ",       // J
  "最終更新",        // K
  "ステータス",       // L ← ユーザー編集列（上書き禁止）
  "メモ",            // M ← ユーザー編集列（上書き禁止）
] as const;

type PortfolioHeader = (typeof PORTFOLIO_HEADERS)[number];

const PCOL: Record<PortfolioHeader, number> = Object.fromEntries(
  PORTFOLIO_HEADERS.map((h, i) => [h, i])
) as Record<PortfolioHeader, number>;

// ===========================
// History シートの列定義
// ===========================

const HISTORY_HEADERS = [
  "記録日時",
  "JPY合計",
  "資産件数",
  "使用モデル",
  "AI推定レート有無",
  "備考",
] as const;

// ===========================
// カテゴリー別背景色
// ===========================

const CATEGORY_COLORS: Record<AssetCategory, string> = {
  Cash: "#e8f5e9",
  Stock: "#e3f2fd",
  Crypto: "#fce4ec",
  Fund: "#f3e5f5",
  Bond: "#fff3e0",
  FX: "#e0f7fa",
  RealEstate: "#f1f8e9",
  Other: "#f5f5f5",
};

// ===========================
// AssetRepository クラス
// ===========================

export class AssetRepository {
  // ===========================
  // AssetInput シート: テキスト取得
  // ===========================

  /**
   * AssetInput シートからテキストを取得する。
   * アクティブセルに内容があればそのセル優先、なければシート全体を結合。
   */
  static getInputText(): string {
    const sheet = AssetRepository.requireSheet(SHEET_NAMES.ASSET_INPUT);

    const activeCell = sheet.getActiveCell();
    if (activeCell) {
      const v = activeCell.getValue();
      if (typeof v === "string" && v.trim().length > 0) return v.trim();
    }

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow === 0 || lastCol === 0) {
      throw new Error(
        `"${SHEET_NAMES.ASSET_INPUT}" シートにテキストが入力されていません。\n` +
        "銀行明細や暗号資産のウォレット画面のテキストを貼り付けてください。"
      );
    }

    const values = sheet.getRange(1, 1, lastRow, lastCol).getValues() as unknown[][];
    const text = values
      .flat()
      .filter((v) => v !== null && v !== undefined && String(v).trim() !== "")
      .map((v) => String(v).trim())
      .join("\n");

    if (!text) {
      throw new Error(
        `"${SHEET_NAMES.ASSET_INPUT}" シートのセルがすべて空です。\n` +
        "金融テキストを貼り付けてから再実行してください。"
      );
    }

    return text;
  }

  // ===========================
  // Portfolio シート: 差分更新
  // ===========================

  /**
   * Portfolio シートを差分更新する。
   * - identifier が一致する行: 数値・レート列のみ更新（ステータス・メモは保持）
   * - 新規 identifier: 末尾に追加
   *
   * @returns { added: number, updated: number }
   */
  static upsertPortfolio(
    items: PortfolioItem[]
  ): { added: number; updated: number } {
    const sheet = AssetRepository.getOrCreatePortfolioSheet();
    const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

    // 既存データの identifier → 行番号マップを作成
    const existingMap = AssetRepository.buildIdentifierRowMap(sheet);

    let added = 0;
    let updated = 0;

    for (const item of items) {
      const id = item.asset.identifier;
      const existingRow = existingMap.get(id);

      if (existingRow !== undefined) {
        // --- 既存行の更新（ユーザー編集列を除く列のみ）---
        AssetRepository.updatePortfolioRow(sheet, existingRow, item, now);
        updated++;
      } else {
        // --- 新規追加 ---
        const newRowIndex = sheet.getLastRow() + 1;
        const rowData = AssetRepository.buildPortfolioRow(item, now);
        sheet.appendRow(rowData);

        // カテゴリー別背景色
        const bgColor = CATEGORY_COLORS[item.asset.category] ?? "#f5f5f5";
        sheet
          .getRange(newRowIndex, 1, 1, PORTFOLIO_HEADERS.length)
          .setBackground(bgColor);

        existingMap.set(id, newRowIndex);
        added++;
      }
    }

    // 列幅の自動調整
    sheet.autoResizeColumns(1, PORTFOLIO_HEADERS.length);

    return { added, updated };
  }

  // ===========================
  // History シート: 追記
  // ===========================

  /**
   * History シートに資産合計スナップショットを追記する。
   */
  static appendHistory(
    totalJpy: number,
    assetCount: number,
    modelUsed: string,
    hasAiEstimate: boolean,
    note = ""
  ): void {
    const sheet = AssetRepository.getOrCreateHistorySheet();
    const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

    sheet.appendRow([now, totalJpy, assetCount, modelUsed, hasAiEstimate ? "あり" : "なし", note]);

    // 最終行を交互行色で整形（可読性向上）
    const lastRow = sheet.getLastRow();
    if (lastRow % 2 === 0) {
      sheet
        .getRange(lastRow, 1, 1, HISTORY_HEADERS.length)
        .setBackground("#f8f9fa");
    }
  }

  /**
   * History シートのデータからポートフォリオ推移グラフを作成・更新する。
   * 既存グラフがあれば削除して再作成する（シンプルな実装）。
   */
  static refreshHistoryChart(): void {
    const sheet = AssetRepository.getOrCreateHistorySheet();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return; // データが1行以下はグラフ不要

    // 既存グラフを削除
    const existingCharts = sheet.getCharts();
    existingCharts.forEach((chart) => sheet.removeChart(chart));

    // 日時列（A）と JPY 合計列（B）でラインチャートを作成
    const dataRange = sheet.getRange(1, 1, lastRow, 2);

    const chart = sheet
      .newChart()
      .setChartType(Charts.ChartType.LINE)
      .addRange(dataRange)
      .setOption("title", "ポートフォリオ推移（JPY）")
      .setOption("legend", { position: "bottom" })
      .setOption("series", {
        0: { color: "#1a73e8", lineWidth: 2 },
      })
      .setOption("vAxis", { format: "¥#,##0" })
      .setPosition(2, 4, 0, 0) // 2行目・4列目の位置にグラフを配置
      .build();

    sheet.insertChart(chart);
  }

  /**
   * Portfolio シートの資産件数を返す（ヘッダー除く）。
   */
  static getPortfolioCount(): number {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.PORTFOLIO);
    if (!sheet) return 0;
    return Math.max(0, sheet.getLastRow() - 1);
  }

  /**
   * History シートの記録件数を返す（ヘッダー除く）。
   */
  static getHistoryCount(): number {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.HISTORY);
    if (!sheet) return 0;
    return Math.max(0, sheet.getLastRow() - 1);
  }

  /**
   * トースト通知を表示する。
   */
  static showToast(message: string, title = "✅ 完了", durationSec = 5): void {
    SpreadsheetApp.getActiveSpreadsheet().toast(message, title, durationSec);
  }

  // ===========================
  // プライベートヘルパー
  // ===========================

  private static requireSheet(
    name: string
  ): GoogleAppsScript.Spreadsheet.Sheet {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
    if (!sheet) {
      throw new Error(
        `"${name}" シートが見つかりません。\n` +
        `スプレッドシートに "${name}" という名前のシートを作成してください。`
      );
    }
    return sheet;
  }

  private static getOrCreatePortfolioSheet(): GoogleAppsScript.Spreadsheet.Sheet {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAMES.PORTFOLIO);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAMES.PORTFOLIO);
      AssetRepository.setupPortfolioHeader(sheet);
    }
    return sheet;
  }

  private static setupPortfolioHeader(
    sheet: GoogleAppsScript.Spreadsheet.Sheet
  ): void {
    const headerRange = sheet.getRange(1, 1, 1, PORTFOLIO_HEADERS.length);
    headerRange.setValues([Array.from(PORTFOLIO_HEADERS)]);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#0d47a1");
    headerRange.setFontColor("#ffffff");
    headerRange.setHorizontalAlignment("center");
    sheet.setFrozenRows(1);

    // identifier 列（A）を非表示（内部キー）
    sheet.hideColumns(PCOL.identifier + 1, 1);

    // ステータス列のドロップダウン
    const statusRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(["保有中", "売却済み", "確認中", "除外"], true)
      .build();
    sheet
      .getRange(2, PCOL.ステータス + 1, sheet.getMaxRows() - 1, 1)
      .setDataValidation(statusRule);
  }

  private static getOrCreateHistorySheet(): GoogleAppsScript.Spreadsheet.Sheet {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAMES.HISTORY);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAMES.HISTORY);
      AssetRepository.setupHistoryHeader(sheet);
    }
    return sheet;
  }

  private static setupHistoryHeader(
    sheet: GoogleAppsScript.Spreadsheet.Sheet
  ): void {
    const headerRange = sheet.getRange(1, 1, 1, HISTORY_HEADERS.length);
    headerRange.setValues([Array.from(HISTORY_HEADERS)]);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#1b5e20");
    headerRange.setFontColor("#ffffff");
    sheet.setFrozenRows(1);

    // JPY合計列に通貨書式を設定
    sheet
      .getRange(2, 2, sheet.getMaxRows() - 1, 1)
      .setNumberFormat("¥#,##0");
  }

  /**
   * Portfolio シートの identifier → 行番号マップを作成する。
   * ヘッダー行（1行目）はスキップ。
   */
  private static buildIdentifierRowMap(
    sheet: GoogleAppsScript.Spreadsheet.Sheet
  ): Map<string, number> {
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return new Map();

    const identifiers = sheet
      .getRange(2, PCOL.identifier + 1, lastRow - 1, 1)
      .getValues() as string[][];

    const map = new Map<string, number>();
    identifiers.forEach(([id], i) => {
      if (id) map.set(String(id), i + 2); // +2: ヘッダー行 + 0始まり補正
    });
    return map;
  }

  /**
   * PortfolioItem を行データ配列に変換する。
   */
  private static buildPortfolioRow(
    item: PortfolioItem,
    updatedAt: string
  ): (string | number | boolean)[] {
    const row: (string | number | boolean)[] = new Array(
      PORTFOLIO_HEADERS.length
    ).fill("");

    row[PCOL.identifier] = item.asset.identifier;
    row[PCOL.カテゴリー] = item.asset.category;
    row[PCOL.資産名] = item.asset.assetName;
    row[PCOL.数量] = item.asset.amount;
    row[PCOL.通貨] = item.asset.currency;
    row[PCOL["レート(JPY)"]] = item.rate?.jpyRate ?? 0;
    row[PCOL.JPY換算額] = item.jpyAmount ?? 0;
    row[PCOL.取得モデル] = item.modelUsed;
    row[PCOL.レートソース] = item.rate?.source ?? "unknown";
    row[PCOL.推定フラグ] = item.rate?.isEstimate ? "⚠️ 推定" : "実データ";
    row[PCOL.最終更新] = updatedAt;
    row[PCOL.ステータス] = "保有中"; // 初期値（以降はユーザー編集）
    row[PCOL.メモ] = "";

    return row;
  }

  /**
   * 既存行の数値・レート列のみを更新する（ユーザー編集列は保持）。
   * 更新列: 数量・通貨・レート・JPY換算額・取得モデル・レートソース・推定フラグ・最終更新
   */
  private static updatePortfolioRow(
    sheet: GoogleAppsScript.Spreadsheet.Sheet,
    rowIndex: number,
    item: PortfolioItem,
    updatedAt: string
  ): void {
    const updateColumns: [PortfolioHeader, string | number | boolean][] = [
      [カテゴリー, item.asset.category],
      [資産名, item.asset.assetName],
      [数量, item.asset.amount],
      [通貨, item.asset.currency],
      ["レート(JPY)", item.rate?.jpyRate ?? 0],
      [JPY換算額, item.jpyAmount ?? 0],
      [取得モデル, item.modelUsed],
      [レートソース, item.rate?.source ?? "unknown"],
      [推定フラグ, item.rate?.isEstimate ? "⚠️ 推定" : "実データ"],
      [最終更新, updatedAt],
    ];

    for (const [header, value] of updateColumns) {
      sheet
        .getRange(rowIndex, PCOL[header] + 1)
        .setValue(value);
    }
  }
}

// TypeScript の型安全のためにヘッダー名を変数として宣言
const カテゴリー: PortfolioHeader = "カテゴリー";
const 資産名: PortfolioHeader = "資産名";
const 数量: PortfolioHeader = "数量";
const 通貨: PortfolioHeader = "通貨";
const JPY換算額: PortfolioHeader = "JPY換算額";
const 取得モデル: PortfolioHeader = "取得モデル";
const レートソース: PortfolioHeader = "レートソース";
const 推定フラグ: PortfolioHeader = "推定フラグ";
const 最終更新: PortfolioHeader = "最終更新";
