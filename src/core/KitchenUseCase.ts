/**
 * @file src/core/KitchenUseCase.ts
 * @description キッチン・在庫管理ユースケース層。
 * ScienceParser → CookingAdvisor → KitchenRepository の流れを統括する。
 */

import { AIClient } from "../infra/AIClient";
import { GasLogger } from "../infra/Logger";
import {
  ScienceIngredient,
  ScienceParseResult,
  buildScienceSystemPrompt,
  buildScienceUserPrompt,
  parseScienceResponse,
} from "./ScienceParser";
import { generateCookingAdvice, CookingAdvice } from "./CookingAdvisor";

// ===========================
// 定数
// ===========================

const MAX_PARSE_RETRIES = 2;
const RETRY_FEEDBACK =
  "\n\n【修正指示】前回の出力は有効な JSON ではありませんでした。" +
  "JSON のみを出力し、コードブロック記号や説明文を含めないでください。";

// ===========================
// 型定義
// ===========================

export interface ScanGroceryOutput {
  ingredients: ScienceIngredient[];
  cookingAdvices: CookingAdvice[];
  sourceSummary: string;
  warnings: string[];
  modelUsed: string;
  fallbackCount: number;
  parseRetryCount: number;
  totalTokens: number | null;
}

// ===========================
// KitchenUseCase クラス
// ===========================

export class KitchenUseCase {
  private readonly aiClient: AIClient;

  constructor(aiClient?: AIClient) {
    this.aiClient = aiClient ?? new AIClient();
  }

  /**
   * 購入品リストをスキャンして食材を解析し、調理アドバイスを生成する。
   *
   * @param rawText - GroceryInput シートのテキスト
   */
  scanGrocery(rawText: string): ScanGroceryOutput {
    // --- Step 1: AI による食材・物理特性の抽出 ---
    const { parsed, modelUsed, fallbackCount, parseRetryCount, totalTokens } =
      this.extractWithRetry(rawText);

    // --- Step 2: TypeScript 側で調理アドバイスを生成（物理計算）---
    const cookingAdvices: CookingAdvice[] = parsed.ingredients.map((ingredient) =>
      generateCookingAdvice(ingredient)
    );

    // --- Step 3: ロギング ---
    GasLogger.logSuccess(
      modelUsed,
      { totalTokenCount: totalTokens ?? undefined },
      `食材スキャン完了: ${parsed.ingredients.length}件 / フォールバック: ${fallbackCount}回`
    );

    return {
      ingredients: parsed.ingredients,
      cookingAdvices,
      sourceSummary: parsed.sourceSummary,
      warnings: parsed.warnings,
      modelUsed,
      fallbackCount,
      parseRetryCount,
      totalTokens,
    };
  }

  // ===========================
  // プライベート
  // ===========================

  private extractWithRetry(rawText: string): {
    parsed: ScienceParseResult;
    modelUsed: string;
    fallbackCount: number;
    parseRetryCount: number;
    totalTokens: number | null;
  } {
    const systemPrompt = buildScienceSystemPrompt();
    let currentUserPrompt = buildScienceUserPrompt(rawText);
    let parseRetryCount = 0;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_PARSE_RETRIES; attempt++) {
      let aiResult: ReturnType<AIClient["generateContent"]> | null = null;

      try {
        aiResult = this.aiClient.generateContent(currentUserPrompt, systemPrompt, {
          temperature: 0.05,
          maxOutputTokens: 4096,
        });

        const parsed = parseScienceResponse(aiResult.text);

        return {
          parsed,
          modelUsed: aiResult.modelUsed,
          fallbackCount: aiResult.fallbackCount,
          parseRetryCount,
          totalTokens: aiResult.usageMetadata.totalTokenCount ?? null,
        };
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));

        if (lastError.message.includes("全てのモデルでAPI呼び出しに失敗しました")) {
          throw lastError;
        }

        if (attempt < MAX_PARSE_RETRIES) {
          parseRetryCount++;
          GasLogger.logError(
            aiResult?.modelUsed ?? "unknown",
            `食材解析 JSONパース失敗 (attempt ${attempt + 1}): ${lastError.message}`
          );
          currentUserPrompt = buildScienceUserPrompt(rawText) + RETRY_FEEDBACK;
        }
      }
    }

    throw new Error(
      `食材解析のJSONパースがリトライ上限(${MAX_PARSE_RETRIES}回)を超えました: ${lastError?.message ?? "不明"}`
    );
  }
}
