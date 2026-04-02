/**
 * @file src/gas/KitchenRepository.ts
 * @description キッチン・猫在庫管理のスプレッドシート操作リポジトリ。
 *
 * 管理シート:
 * - GroceryInput     : レシート・購入品リストを自由に貼り付ける
 * - Inventory        : 食材＋猫用品の統合在庫テーブル
 * - CookingDashboard : 本日の食材リストと調理アドバイスのダッシュボード
 */

import { ScienceIngredient, StorageMethod, IngredientCategory } from "../core/ScienceParser";
import { CookingAdvice } from "../core/CookingAdvisor";
import {
  StockStatus,
  StockStatusLevel,
  CatSupplyCategory,
  InventorySummary,
  getStatusColor,
  getStatusLabel,
} from "../core/CatInventory";

// ===========================
// シート名定数
// ===========================

const SHEET_NAMES = {
  GROCERY_INPUT: "GroceryInput",
  INVENTORY: "Inventory",
  COOKING_DASHBOARD: "CookingDashboard",
} as const;

// ===========================
// Inventory シートの列定義
// ===========================

/**
 * 列構成: [カテゴリー | 品目 | 残量 | 単位 | 物理特性データ | 抽出モデル]
 * 先頭に identifier（非表示の差分更新キー）を配置。
 */
const INVENTORY_HEADERS = [
  "id",             // A: 差分更新キー（非表示）
  "アイテム種別",    // B: "food" | "cat"
  "カテゴリー",     // C
  "品目",           // D
  "残量",           // E
  "単位",           // F
  // 食材用 物理特性データ
  "タンパク質(g/100g)", // G
  "水分量(g/100g)",     // H
  "脂質(g/100g)",       // I
  "比熱(J/g·K)",        // J
  "メイラード温度(°C)", // K
  "賞味期限(日)",       // L
  // 猫用品拡張フィールド
  "日消費量",           // M
  "残り日数",           // N
  "ステータス",         // O
  // 共通
  "価格(円)",           // P
  "抽出モデル",         // Q
  "最終更新",           // R
  "メモ",               // S ← ユーザー編集列（上書き禁止）
] as const;

type InvHeader = (typeof INVENTORY_HEADERS)[number];

const ICOL: Record<InvHeader, number> = Object.fromEntries(
  INVENTORY_HEADERS.map((h, i) => [h, i])
) as Record<InvHeader, number>;

// ===========================
// CookingDashboard の定義
// ===========================

const DASHBOARD_HEADERS = [
  "食材名",
  "水分量(%)",
  "タンパク質(%)",
  "メイラードスコア",
  "推奨調理法",
  "食品安全(75°C)目安",
  "賞味期限アラート",
  "比熱(計算値)",
] as const;

// ===========================
// KitchenRepository クラス
// ===========================

export class KitchenRepository {
  // ===========================
  // GroceryInput: テキスト取得
  // ===========================

  /**
   * GroceryInput シートからテキストを取得する。
   */
  static getGroceryInputText(): string {
    const sheet = KitchenRepository.requireSheet(SHEET_NAMES.GROCERY_INPUT);

    // アクティブセル優先
    const activeCell = sheet.getActiveCell();
    if (activeCell) {
      const v = activeCell.getValue();
      if (typeof v === "string" && v.trim().length > 0) return v.trim();
    }

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow === 0 || lastCol === 0) {
      throw new Error(
        `"${SHEET_NAMES.GROCERY_INPUT}" シートにテキストが入力されていません。\n` +
        "レシートや購入品リストを貼り付けてから再実行してください。"
      );
    }

    const values = sheet
      .getRange(1, 1, lastRow, lastCol)
      .getValues() as unknown[][];

    const text = values
      .flat()
      .filter((v) => v !== null && v !== undefined && String(v).trim() !== "")
      .map((v) => String(v).trim())
      .join("\n");

    if (!text) {
      throw new Error(`"${SHEET_NAMES.GROCERY_INPUT}" シートが空です。`);
    }
    return text;
  }

  // ===========================
  // Inventory: 食材の差分更新
  // ===========================

  /**
   * 解析済み食材リストを Inventory シートに差分更新する。
   * id をキーとして既存行を更新し、新規は末尾追記。
   * メモ列（ユーザー編集）は一切上書きしない。
   */
  static upsertIngredients(
    ingredients: ScienceIngredient[],
    modelUsed: string
  ): { added: number; updated: number } {
    const sheet = KitchenRepository.getOrCreateInventorySheet();
    const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
    const existingMap = KitchenRepository.buildIdRowMap(sheet);

    let added = 0;
    let updated = 0;

    for (const item of ingredients) {
      const id = `food_${item.name.replace(/\s+/g, "_").slice(0, 30)}`;
      const existingRow = existingMap.get(id);

      if (existingRow !== undefined) {
        KitchenRepository.updateIngredientRow(sheet, existingRow, item, modelUsed, now);
        updated++;
      } else {
        const rowData = KitchenRepository.buildIngredientRow(id, item, modelUsed, now);
        const newRow = sheet.getLastRow() + 1;
        sheet.appendRow(rowData);
        KitchenRepository.setIngredientRowStyle(sheet, newRow, item.category);
        existingMap.set(id, newRow);
        added++;
      }
    }

    sheet.autoResizeColumns(1, INVENTORY_HEADERS.length);
    return { added, updated };
  }

  // ===========================
  // Inventory: 猫用品の差分更新
  // ===========================

  /**
   * 猫用品在庫を Inventory シートに差分更新する。
   * ステータス・残り日数は計算値で常に更新。
   * メモ列のみ保護。
   */
  static upsertCatSupplies(
    supplies: StockStatus[],
    modelUsed: string
  ): { added: number; updated: number } {
    const sheet = KitchenRepository.getOrCreateInventorySheet();
    const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
    const existingMap = KitchenRepository.buildIdRowMap(sheet);

    let added = 0;
    let updated = 0;

    for (const supply of supplies) {
      const id = `cat_${supply.id}`;
      const existingRow = existingMap.get(id);

      if (existingRow !== undefined) {
        KitchenRepository.updateCatSupplyRow(sheet, existingRow, supply, modelUsed, now);
        updated++;
      } else {
        const rowData = KitchenRepository.buildCatSupplyRow(id, supply, modelUsed, now);
        const newRow = sheet.getLastRow() + 1;
        sheet.appendRow(rowData);
        // 在庫ステータスに応じた背景色
        const bgColor = getStatusColor(supply.statusLevel);
        sheet
          .getRange(newRow, ICOL.ステータス + 1)
          .setBackground(bgColor)
          .setFontColor("#ffffff")
          .setFontWeight("bold");
        existingMap.set(id, newRow);
        added++;
      }
    }

    return { added, updated };
  }

  // ===========================
  // CookingDashboard: 調理アドバイス表示
  // ===========================

  /**
   * CookingDashboard シートに本日の調理アドバイスを書き出す。
   * 毎回全体を書き直す（ダッシュボードは当日分のみ表示）。
   */
  static writeCookingDashboard(advices: CookingAdvice[]): void {
    const sheet = KitchenRepository.getOrCreateDashboardSheet();

    // ヘッダー以降をクリア
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, DASHBOARD_HEADERS.length).clearContent();
    }

    const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

    // タイトル行を更新
    sheet.getRange(1, 1).setValue(`📊 調理ダッシュボード（更新: ${now}）`);

    advices.forEach((advice, i) => {
      const row = i + 2;
      const m = advice.maillard;
      const h = advice.heating;

      const rowData = [
        advice.ingredientName,
        advice.maillard.drySurfaceTimeSec > 0  // 水分量(%)を逆算表示
          ? "" // placeholder（以下で個別セットする）
          : "",
        "",
        m.maillardScore,
        m.heatLevelDescription,
        h.timeTo75CSec < 9999
          ? `約 ${Math.round(h.timeTo75CSec / 60)} 分 ${h.timeTo75CSec % 60} 秒`
          : "温度不足",
        advice.shelfLifeAlert ?? "✅ 問題なし",
        advice.heating.restTimeSec > 0 ? `計算済み` : "-",
      ];

      sheet.appendRow(rowData);

      // メイラードスコアに応じた行の色付け
      const scoreColor =
        m.maillardScore >= 60
          ? "#e8f5e9"
          : m.maillardScore >= 30
          ? "#fff3e0"
          : "#fce4ec";
      sheet
        .getRange(row, 1, 1, DASHBOARD_HEADERS.length)
        .setBackground(scoreColor);

      // 賞味期限アラートは赤字
      if (advice.shelfLifeAlert) {
        sheet
          .getRange(row, DASHBOARD_HEADERS.indexOf("賞味期限アラート") + 1)
          .setFontColor("#c62828")
          .setFontWeight("bold");
      }
    });

    sheet.autoResizeColumns(1, DASHBOARD_HEADERS.length);
  }

  /**
   * 猫在庫サマリーをダッシュボード下部に追記する。
   */
  static writeCatInventorySummary(summary: InventorySummary): void {
    const sheet = KitchenRepository.getOrCreateDashboardSheet();
    const insertRow = sheet.getLastRow() + 2; // 空行を1つ挟む

    // セクションヘッダー
    const headerRange = sheet.getRange(insertRow, 1, 1, 4);
    headerRange.setValues([["🐱 猫用品 在庫状況", "", "", ""]]);
    headerRange.merge();
    headerRange
      .setBackground("#4a148c")
      .setFontColor("#ffffff")
      .setFontWeight("bold")
      .setFontSize(11);

    let currentRow = insertRow + 1;

    const allItems = [
      ...summary.emptyItems,
      ...summary.criticalItems,
      ...summary.warningItems,
      ...summary.okItems,
    ];

    for (const item of allItems) {
      const daysText =
        item.remainingDays >= 9999
          ? "—"
          : `残り ${item.remainingDays} 日`;
      const purchaseText =
        item.recommendedPurchaseAmount > 0
          ? `要購入: ${item.recommendedPurchaseAmount}${item.unit}`
          : "充足";

      sheet.getRange(currentRow, 1, 1, 4).setValues([
        [
          getStatusLabel(item.statusLevel),
          item.name,
          `${item.currentAmount}${item.unit}（${daysText}）`,
          purchaseText,
        ],
      ]);

      // ステータスカラーで背景色設定
      const bgColor = getStatusColor(item.statusLevel);
      sheet
        .getRange(currentRow, 1)
        .setBackground(bgColor)
        .setFontColor("#ffffff")
        .setFontWeight("bold");

      currentRow++;
    }
  }

  /**
   * Inventory シートの食材件数を返す（ヘッダー除く）。
   */
  static getInventoryCount(): number {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.INVENTORY);
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

  private static requireSheet(name: string): GoogleAppsScript.Spreadsheet.Sheet {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
    if (!sheet) {
      throw new Error(
        `"${name}" シートが見つかりません。\n` +
        `スプレッドシートに "${name}" という名前のシートを作成してください。`
      );
    }
    return sheet;
  }

  private static getOrCreateInventorySheet(): GoogleAppsScript.Spreadsheet.Sheet {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAMES.INVENTORY);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAMES.INVENTORY);
      KitchenRepository.setupInventoryHeader(sheet);
    }
    return sheet;
  }

  private static setupInventoryHeader(sheet: GoogleAppsScript.Spreadsheet.Sheet): void {
    const headerRange = sheet.getRange(1, 1, 1, INVENTORY_HEADERS.length);
    headerRange.setValues([Array.from(INVENTORY_HEADERS)]);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#212121"); // Material Black
    headerRange.setFontColor("#ffffff");
    headerRange.setHorizontalAlignment("center");
    sheet.setFrozenRows(1);
    // id 列を非表示
    sheet.hideColumns(ICOL.id + 1, 1);
  }

  private static getOrCreateDashboardSheet(): GoogleAppsScript.Spreadsheet.Sheet {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAMES.COOKING_DASHBOARD);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAMES.COOKING_DASHBOARD);
      // ヘッダー行（2行目に列ヘッダー、1行目はタイトル）
      const headerRange = sheet.getRange(2, 1, 1, DASHBOARD_HEADERS.length);
      headerRange.setValues([Array.from(DASHBOARD_HEADERS)]);
      headerRange.setFontWeight("bold");
      headerRange.setBackground("#bf360c"); // Deep Orange 900
      headerRange.setFontColor("#ffffff");
      sheet.setFrozenRows(2);
    }
    return sheet;
  }

  /** id → 行番号マップを構築する */
  private static buildIdRowMap(
    sheet: GoogleAppsScript.Spreadsheet.Sheet
  ): Map<string, number> {
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return new Map();
    const ids = sheet
      .getRange(2, ICOL.id + 1, lastRow - 1, 1)
      .getValues() as string[][];
    const map = new Map<string, number>();
    ids.forEach(([id], i) => {
      if (id) map.set(String(id), i + 2);
    });
    return map;
  }

  /** 食材行データを配列に変換する */
  private static buildIngredientRow(
    id: string,
    item: ScienceIngredient,
    modelUsed: string,
    now: string
  ): (string | number | null)[] {
    const row: (string | number | null)[] = new Array(INVENTORY_HEADERS.length).fill("");
    row[ICOL.id] = id;
    row[ICOL.アイテム種別] = "food";
    row[ICOL.カテゴリー] = item.category;
    row[ICOL.品目] = item.name;
    row[ICOL.残量] = item.weightGram ?? "";
    row[ICOL.単位] = "g";
    row[ICOL["タンパク質(g/100g)"]] = item.proteinContent;
    row[ICOL["水分量(g/100g)"]] = item.waterContent;
    row[ICOL["脂質(g/100g)"]] = item.fatContent;
    row[ICOL["比熱(J/g·K)"]] = item.specificHeat;
    row[ICOL["メイラード温度(°C)"]] = item.maillardThresholdTemp;
    row[ICOL["賞味期限(日)"]] = item.shelfLifeDays;
    row[ICOL.日消費量] = "";
    row[ICOL.残り日数] = item.shelfLifeDays;
    row[ICOL.ステータス] = "保有中";
    row[ICOL["価格(円)"]] = item.priceYen ?? "";
    row[ICOL.抽出モデル] = modelUsed;
    row[ICOL.最終更新] = now;
    row[ICOL.メモ] = "";
    return row;
  }

  /** 食材の既存行を更新する（メモ列を保護） */
  private static updateIngredientRow(
    sheet: GoogleAppsScript.Spreadsheet.Sheet,
    rowIndex: number,
    item: ScienceIngredient,
    modelUsed: string,
    now: string
  ): void {
    const updates: [InvHeader, string | number | null][] = [
      ["カテゴリー", item.category],
      ["品目", item.name],
      ["残量", item.weightGram ?? ""],
      ["タンパク質(g/100g)", item.proteinContent],
      ["水分量(g/100g)", item.waterContent],
      ["脂質(g/100g)", item.fatContent],
      ["比熱(J/g·K)", item.specificHeat],
      ["メイラード温度(°C)", item.maillardThresholdTemp],
      ["賞味期限(日)", item.shelfLifeDays],
      ["残り日数", item.shelfLifeDays],
      ["価格(円)", item.priceYen ?? ""],
      ["抽出モデル", modelUsed],
      ["最終更新", now],
    ];
    for (const [header, value] of updates) {
      sheet.getRange(rowIndex, ICOL[header] + 1).setValue(value);
    }
  }

  /** 猫用品行データを配列に変換する */
  private static buildCatSupplyRow(
    id: string,
    supply: StockStatus,
    modelUsed: string,
    now: string
  ): (string | number)[] {
    const row: (string | number)[] = new Array(INVENTORY_HEADERS.length).fill("");
    row[ICOL.id] = id;
    row[ICOL.アイテム種別] = "cat";
    row[ICOL.カテゴリー] = supply.category;
    row[ICOL.品目] = supply.name;
    row[ICOL.残量] = supply.currentAmount;
    row[ICOL.単位] = supply.unit;
    row[ICOL.日消費量] = supply.dailyConsumption;
    row[ICOL.残り日数] = supply.remainingDays >= 9999 ? "—" : supply.remainingDays;
    row[ICOL.ステータス] = getStatusLabel(supply.statusLevel);
    row[ICOL.抽出モデル] = modelUsed;
    row[ICOL.最終更新] = now;
    row[ICOL.メモ] = supply.notes;
    return row;
  }

  /** 猫用品の既存行を更新する */
  private static updateCatSupplyRow(
    sheet: GoogleAppsScript.Spreadsheet.Sheet,
    rowIndex: number,
    supply: StockStatus,
    modelUsed: string,
    now: string
  ): void {
    const updates: [InvHeader, string | number][] = [
      ["残量", supply.currentAmount],
      ["日消費量", supply.dailyConsumption],
      ["残り日数", supply.remainingDays >= 9999 ? "—" : supply.remainingDays],
      ["ステータス", getStatusLabel(supply.statusLevel)],
      ["抽出モデル", modelUsed],
      ["最終更新", now],
    ];
    for (const [header, value] of updates) {
      sheet.getRange(rowIndex, ICOL[header] + 1).setValue(value);
    }
    // ステータスセルの色を更新
    sheet
      .getRange(rowIndex, ICOL.ステータス + 1)
      .setBackground(getStatusColor(supply.statusLevel))
      .setFontColor("#ffffff")
      .setFontWeight("bold");
  }

  /** カテゴリーに応じた行スタイルを設定する */
  private static setIngredientRowStyle(
    sheet: GoogleAppsScript.Spreadsheet.Sheet,
    rowIndex: number,
    category: IngredientCategory
  ): void {
    const CATEGORY_BG: Record<IngredientCategory, string> = {
      meat:       "#fce4ec",
      seafood:    "#e3f2fd",
      vegetable:  "#e8f5e9",
      fruit:      "#fff9c4",
      dairy:      "#f3e5f5",
      grain:      "#fff3e0",
      legume:     "#e0f2f1",
      condiment:  "#fafafa",
      egg:        "#fffde7",
      mushroom:   "#efebe9",
      seaweed:    "#e8eaf6",
      processed:  "#f5f5f5",
      fat:        "#fff8e1",
      other:      "#f9fbe7",
    };
    const bg = CATEGORY_BG[category] ?? "#ffffff";
    sheet.getRange(rowIndex, 1, 1, INVENTORY_HEADERS.length).setBackground(bg);
  }
}
