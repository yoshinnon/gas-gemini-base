/**
 * @file src/core/AssetUseCase.ts
 * @description 資産解析ユースケース層。
 * AssetParser・FinanceApiService を統括し、JPY 換算済みポートフォリオを生成する。
 */

import { AIClient } from "../infra/AIClient";
import { GasLogger } from "../infra/Logger";
import { FinanceApiService, ExchangeRate, RateMap } from "../infra/FinanceApi";
import {
  AssetItem,
  AssetExtractionResult,
  buildAssetSystemPrompt,
  buildAssetUserPrompt,
  parseAssetResponse,
} from "./AssetParser";

// ===========================
// 定数
// ===========================

const MAX_PARSE_RETRIES = 2;

const RETRY_FEEDBACK =
  "\n\n【重要な修正指示】前回の出力は有効な JSON ではありませんでした。" +
  "JSON のみを出力し、コードブロック記号や説明文を一切含めないでください。";

// ===========================
// 型定義
// ===========================

/** JPY換算済みの資産1件 */
export interface PortfolioItem {
  asset: AssetItem;
  /** JPY 換算レート情報 */
  rate: ExchangeRate | null;
  /** JPY 換算額（換算不能の場合は null） */
  jpyAmount: number | null;
  /** 抽出に使用したモデル名 */
  modelUsed: string;
}

/** ユースケース出力 */
export interface AssetAnalysisOutput {
  portfolioItems: PortfolioItem[];
  /** 全資産の JPY 合計（換算不能資産を除く） */
  totalJpy: number;
  /** AI による入力サマリー */
  sourceSummary: string;
  /** 解析上の警告 */
  warnings: string[];
  /** 使用モデル名 */
  modelUsed: string;
  /** フォールバック回数 */
  fallbackCount: number;
  /** パースリトライ回数 */
  parseRetryCount: number;
  /** 消費トークン数 */
  totalTokens: number | null;
  /** レート取得に AI推論を使用したか */
  hasAiEstimateRates: boolean;
}

// ===========================
// AssetUseCase クラス
// ===========================

export class AssetUseCase {
  private readonly aiClient: AIClient;
  private readonly financeApi: FinanceApiService;

  constructor(aiClient?: AIClient, financeApi?: FinanceApiService) {
    this.aiClient = aiClient ?? new AIClient();
    this.financeApi = financeApi ?? new FinanceApiService(this.aiClient);
  }

  /**
   * 雑多なテキストから資産を解析し、JPY換算済みポートフォリオを返す。
   *
   * @param rawText - AssetInput シートから取得した生テキスト
   * @returns JPY換算済みポートフォリオ
   */
  analyzeAssets(rawText: string): AssetAnalysisOutput {
    // --- Step 1: AI による資産抽出（リトライ付き）---
    const { extracted, modelUsed, fallbackCount, parseRetryCount, totalTokens } =
      this.extractWithRetry(rawText);

    // --- Step 2: 必要な通貨セットを抽出 ---
    const currencies = FinanceApiService.extractCurrencies(extracted.assets);

    // --- Step 3: 為替・価格レート取得（フォールバック付き）---
    let rateMap: RateMap;
    try {
      rateMap = this.financeApi.fetchRates(currencies);
    } catch (e) {
      GasLogger.logError("FinanceApi", e instanceof Error ? e.message : String(e));
      rateMap = new Map(); // 空で続行（JPY換算不能として扱う）
    }

    // --- Step 4: JPY 換算 ---
    const portfolioItems: PortfolioItem[] = extracted.assets.map((asset) => {
      const rate = rateMap.get(asset.currency) ?? null;
      const jpyAmount = FinanceApiService.calcJpyAmount(asset.amount, rate ?? undefined);
      return { asset, rate, jpyAmount, modelUsed };
    });

    // --- Step 5: 合計計算 ---
    const totalJpy = portfolioItems.reduce(
      (sum, item) => sum + (item.jpyAmount ?? 0),
      0
    );

    // --- Step 6: AI推論レート使用フラグ ---
    const hasAiEstimateRates = [...rateMap.values()].some((r) => r.isEstimate);

    // --- Step 7: 結果ロギング ---
    GasLogger.logSuccess(
      modelUsed,
      { totalTokenCount: totalTokens ?? undefined },
      `資産解析完了: ${extracted.assets.length}件 / 合計 ${totalJpy.toLocaleString()}円 / モデル: ${modelUsed}`
    );

    return {
      portfolioItems,
      totalJpy,
      sourceSummary: extracted.sourceSummary,
      warnings: [
        ...extracted.warnings,
        ...(hasAiEstimateRates
          ? ["⚠️ 一部の為替レートはAIによる推定値です。投資判断には使用しないでください。"]
          : []),
      ],
      modelUsed,
      fallbackCount,
      parseRetryCount,
      totalTokens,
      hasAiEstimateRates,
    };
  }

  // ===========================
  // プライベートメソッド
  // ===========================

  /** AI呼び出し + JSONパース失敗時リトライ */
  private extractWithRetry(rawText: string): {
    extracted: AssetExtractionResult;
    modelUsed: string;
    fallbackCount: number;
    parseRetryCount: number;
    totalTokens: number | null;
  } {
    const systemPrompt = buildAssetSystemPrompt();
    let currentUserPrompt = buildAssetUserPrompt(rawText);
    let parseRetryCount = 0;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_PARSE_RETRIES; attempt++) {
      let aiResult: ReturnType<AIClient["generateContent"]> | null = null;

      try {
        aiResult = this.aiClient.generateContent(currentUserPrompt, systemPrompt, {
          temperature: 0.05,
          maxOutputTokens: 4096,
        });

        const extracted = parseAssetResponse(aiResult.text);

        return {
          extracted,
          modelUsed: aiResult.modelUsed,
          fallbackCount: aiResult.fallbackCount,
          parseRetryCount,
          totalTokens: aiResult.usageMetadata.totalTokenCount ?? null,
        };
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));

        // API 全失敗はリトライしない
        if (lastError.message.includes("全てのモデルでAPI呼び出しに失敗しました")) {
          throw lastError;
        }

        if (attempt < MAX_PARSE_RETRIES) {
          parseRetryCount++;
          const modelLabel = aiResult?.modelUsed ?? "不明";
          GasLogger.logError(
            modelLabel,
            `資産解析 JSONパース失敗 (attempt ${attempt + 1}): ${lastError.message}`
          );
          currentUserPrompt = buildAssetUserPrompt(rawText) + RETRY_FEEDBACK;
        }
      }
    }

    throw new Error(
      `資産解析のJSONパースがリトライ上限(${MAX_PARSE_RETRIES}回)を超えました: ${lastError?.message ?? "不明"}`
    );
  }
}
