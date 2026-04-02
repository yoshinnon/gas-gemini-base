/**
 * @file index.ts
 * @description GAS グローバル関数のエントリポイント。
 * このファイルでエクスポートした関数が clasp push 後に GAS から呼び出せる。
 *
 * 【GASトリガーの登録方法】
 * - onOpen: スプレッドシートにバインドされたスクリプトとして「起動時」に自動実行
 * - その他: GAS エディタ > トリガー から手動登録、またはメニューから実行
 */

// プレゼンテーション層（GAS メニュー・UI）
export {
  onOpen,
  runDiagnostics,
  showActiveModel,
  openLogSheet,
  promptApiKeySetup,
} from "./presentation/index";

// 議事録解析メニュー
export {
  runTaskExtraction,
  showTaskBoardStatus,
} from "./presentation/TaskMenu";

// キッチン・在庫管理メニュー
export {
  runGroceryScan,
  showCookingAdvicePopup,
  showCatInventoryAlert,
  showPastaEmulsificationGuide,
} from "./presentation/KitchenMenu";

// 資産解析メニュー
export {
  runAssetAnalysis,
  showPortfolioSummary,
} from "./presentation/AssetMenu";

// インフラ層（外部からも利用できるようエクスポート）
export { AIClient, MODEL_PRIORITY } from "./infra/AIClient";
export { Config } from "./infra/Config";
export { GasLogger } from "./infra/Logger";
