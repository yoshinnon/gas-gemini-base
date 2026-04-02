/**
 * @file Config.ts
 * @description PropertiesService のラッパー。
 * APIキーや設定値をスクリプトプロパティから安全に取得する。
 *
 * 【設定方法】
 * GAS エディタ > プロジェクトの設定 > スクリプトプロパティ に以下を追加:
 *   GEMINI_API_KEY : your_api_key_here
 *   LOG_SHEET_NAME : AI_Log  (省略可, デフォルト: "AI_Log")
 */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export class Config {
  // スクリプトプロパティのキー名を定数で管理（変更容易性）
  private static readonly KEY_GEMINI_API_KEY = "GEMINI_API_KEY";
  private static readonly KEY_LOG_SHEET_NAME = "LOG_SHEET_NAME";
  private static readonly DEFAULT_LOG_SHEET_NAME = "AI_Log";

  /**
   * Gemini API キーを取得する。
   * 未設定の場合は ConfigError をスローし、ユーザーに設定を促す。
   */
  static getGeminiApiKey(): string {
    const key = PropertiesService.getScriptProperties().getProperty(
      Config.KEY_GEMINI_API_KEY
    );

    if (!key || key.trim() === "") {
      throw new ConfigError(
        [
          "Gemini API キーが設定されていません。",
          "GAS エディタ > プロジェクトの設定 > スクリプトプロパティ に",
          `"${Config.KEY_GEMINI_API_KEY}" キーを追加してください。`,
          "APIキーは https://aistudio.google.com/app/apikey から取得できます。",
        ].join("\n")
      );
    }

    return key.trim();
  }

  /**
   * ログ用シート名を取得する。
   * 未設定の場合はデフォルト値を返す。
   */
  static getLogSheetName(): string {
    return (
      PropertiesService.getScriptProperties().getProperty(
        Config.KEY_LOG_SHEET_NAME
      ) ?? Config.DEFAULT_LOG_SHEET_NAME
    );
  }

  /**
   * スクリプトプロパティに値をセットするユーティリティ（初期設定用）。
   * GAS コンソールから手動実行して初期セットアップに利用可能。
   */
  static setProperty(key: string, value: string): void {
    PropertiesService.getScriptProperties().setProperty(key, value);
  }

  /**
   * 現在設定されているプロパティキーの一覧を返す（値は含まない）。
   * デバッグ・診断目的。
   */
  static listPropertyKeys(): string[] {
    return Object.keys(
      PropertiesService.getScriptProperties().getProperties()
    );
  }
}
