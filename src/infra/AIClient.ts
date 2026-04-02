/**
 * @file AIClient.ts
 * @description マルチモデル対応 Gemini API クライアント。
 * 429 (Too Many Requests) 等のエラー発生時に次のモデルへ自動フォールバックする。
 *
 * 【モデルの追加・変更方法】
 * MODEL_PRIORITY 配列の要素を増減させるだけで切り替えロジックは自動的に適用される。
 */

import { Config, ConfigError } from "./Config";
import { GasLogger, UsageMetadata } from "./Logger";

// ===========================
// 型定義
// ===========================

/** Gemini API へのリクエストボディ */
export interface GeminiRequest {
  contents: Array<{
    role?: "user" | "model";
    parts: Array<{ text: string }>;
  }>;
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    topK?: number;
  };
  systemInstruction?: {
    parts: Array<{ text: string }>;
  };
}

/** Gemini API からのレスポンスボディ */
export interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: UsageMetadata;
  error?: {
    code: number;
    message: string;
    status: string;
  };
}

/** generateContent の戻り値 */
export interface GenerateContentResult {
  text: string;
  modelUsed: string;
  usageMetadata: UsageMetadata;
  fallbackCount: number;
}

/** フォールバックをトリガーするHTTPステータスコード */
const FALLBACK_STATUS_CODES: number[] = [
  429, // Too Many Requests (レートリミット)
  503, // Service Unavailable
  500, // Internal Server Error
];

/** Gemini API のベースURL */
const GEMINI_API_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";

// ===========================
// モデル優先順位リスト
// ===========================
/**
 * 使用するモデルの優先順位リスト。
 * 配列の先頭から順に試行し、失敗した場合は次のモデルへフォールバックする。
 * モデルの追加・変更はここを編集するだけでよい。
 */
export const MODEL_PRIORITY: string[] = [
  "gemini-2.5-flash-preview-04-17", // 最優先（gemini-3-flash-previewの正式モデルID）
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite-preview-06-17",
];

// ===========================
// AIClient クラス
// ===========================

export class AIClient {
  private readonly apiKey: string;
  private readonly models: string[];

  /**
   * @param models - 使用するモデルの優先順位リスト（省略時は MODEL_PRIORITY を使用）
   * @throws ConfigError - APIキーが未設定の場合
   */
  constructor(models: string[] = MODEL_PRIORITY) {
    this.apiKey = Config.getGeminiApiKey();
    if (models.length === 0) {
      throw new Error("モデルリストが空です。最低1つのモデルを指定してください。");
    }
    this.models = [...models]; // 参照コピーで外部変更を防ぐ
  }

  /**
   * テキスト生成を実行する。
   * 失敗した場合は次のモデルへ自動フォールバックする。
   *
   * @param prompt - ユーザーへのプロンプト
   * @param systemPrompt - システムプロンプト（省略可）
   * @param generationConfig - 生成設定（省略可）
   * @returns 生成結果（使用モデル名・トークン数を含む）
   * @throws Error - 全モデルが失敗した場合
   */
  generateContent(
    prompt: string,
    systemPrompt?: string,
    generationConfig?: GeminiRequest["generationConfig"]
  ): GenerateContentResult {
    const request = AIClient.buildRequest(prompt, systemPrompt, generationConfig);
    let fallbackCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < this.models.length; i++) {
      const modelName = this.models[i];

      try {
        const result = this.callApi(modelName, request);

        // 成功時: ログを記録して結果を返す
        GasLogger.logSuccess(
          modelName,
          result.usageMetadata,
          `プロンプト長: ${prompt.length}文字`
        );

        return {
          text: result.text,
          modelUsed: modelName,
          usageMetadata: result.usageMetadata,
          fallbackCount,
        };
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        errors.push(`[${modelName}] ${errorMsg}`);

        // 最後のモデルでなければフォールバック
        if (i < this.models.length - 1) {
          const nextModel = this.models[i + 1];
          GasLogger.logFallback(modelName, nextModel, errorMsg);
          fallbackCount++;
          console.warn(
            `[AIClient] ${modelName} 失敗。${nextModel} へフォールバック中...`
          );
        } else {
          // 全モデル失敗
          GasLogger.logError(modelName, `全モデル失敗: ${errors.join(" | ")}`);
        }
      }
    }

    throw new Error(
      [
        "全てのモデルでAPI呼び出しに失敗しました。",
        "試行したモデルとエラー:",
        ...errors.map((e) => `  • ${e}`),
      ].join("\n")
    );
  }

  /**
   * 現在設定されているモデルリストを返す（読み取り専用）。
   */
  getModels(): readonly string[] {
    return this.models;
  }

  /**
   * 指定モデルのAPIエンドポイントURLを生成する。
   */
  static buildEndpoint(modelName: string, apiKey: string): string {
    return `${GEMINI_API_BASE}/${modelName}:generateContent?key=${apiKey}`;
  }

  /**
   * Gemini API リクエストボディを構築する。
   */
  private static buildRequest(
    prompt: string,
    systemPrompt?: string,
    generationConfig?: GeminiRequest["generationConfig"]
  ): GeminiRequest {
    const request: GeminiRequest = {
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
    };

    if (systemPrompt) {
      request.systemInstruction = {
        parts: [{ text: systemPrompt }],
      };
    }

    if (generationConfig) {
      request.generationConfig = generationConfig;
    }

    return request;
  }

  /**
   * 指定モデルに対してAPIを呼び出す。
   * フォールバック対象のエラーが発生した場合は Error をスローする。
   */
  private callApi(
    modelName: string,
    request: GeminiRequest
  ): { text: string; usageMetadata: UsageMetadata } {
    const url = AIClient.buildEndpoint(modelName, this.apiKey);

    const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(request),
      muteHttpExceptions: true, // HTTPエラーを例外にせず、レスポンスとして受け取る
    };

    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();

    // フォールバック対象のHTTPエラー
    if (FALLBACK_STATUS_CODES.includes(statusCode)) {
      throw new Error(
        `HTTP ${statusCode}: ${AIClient.extractApiError(responseText)}`
      );
    }

    // その他のHTTPエラー（4xx 系など）
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(
        `HTTP ${statusCode}: ${AIClient.extractApiError(responseText)}`
      );
    }

    // レスポンスのパース
    const parsed: GeminiResponse = JSON.parse(responseText);

    // APIレベルのエラー（200 OK でもエラーが返ることがある）
    if (parsed.error) {
      const shouldFallback = FALLBACK_STATUS_CODES.includes(parsed.error.code);
      throw new Error(
        `API Error ${parsed.error.code} (${parsed.error.status}): ${parsed.error.message}${
          shouldFallback ? " [フォールバック対象]" : ""
        }`
      );
    }

    // テキスト抽出
    const text =
      parsed.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("") ?? "";

    if (!text) {
      throw new Error(
        `モデル ${modelName} からの応答テキストが空でした。finishReason: ${
          parsed.candidates?.[0]?.finishReason ?? "不明"
        }`
      );
    }

    return {
      text,
      usageMetadata: parsed.usageMetadata ?? {},
    };
  }

  /**
   * APIエラーレスポンスからエラーメッセージを抽出する。
   */
  private static extractApiError(responseText: string): string {
    try {
      const parsed: GeminiResponse = JSON.parse(responseText);
      return parsed.error?.message ?? responseText;
    } catch {
      return responseText;
    }
  }
}
