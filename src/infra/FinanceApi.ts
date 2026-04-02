/**
 * @file src/infra/FinanceApi.ts
 * @description 為替レート・暗号資産価格の取得サービス。
 *
 * 取得戦略（優先順位）:
 * 1. ExchangeRate-API (無料枠: 1500 req/月)  — 法定通貨間レート
 * 2. CoinGecko API (無料枠: 10,000 req/月) — 暗号資産価格
 * 3. AIClient による概算レート推論            — 両APIが失敗した場合のフォールバック
 *
 * ⚠️ AI推論レートは教育・参考目的のみ。投資判断には使用しないこと。
 */

import { AIClient } from "./AIClient";
import { GasLogger } from "./Logger";
import { CurrencyCode } from "../core/AssetParser";

// ===========================
// 型定義
// ===========================

/** 為替レート1件（XXX → JPY） */
export interface ExchangeRate {
  /** 変換元通貨コード */
  from: CurrencyCode;
  /** JPY換算レート（1 from = jpyRate JPY） */
  jpyRate: number;
  /** レートの取得元 */
  source: "exchangerate-api" | "coingecko" | "ai-estimate" | "manual";
  /** 取得日時（ISO 8601） */
  fetchedAt: string;
  /** AI推論の場合は警告フラグを立てる */
  isEstimate: boolean;
}

/** RateMap: 通貨コード → ExchangeRate */
export type RateMap = Map<CurrencyCode, ExchangeRate>;

// ===========================
// API エンドポイント定数
// ===========================

/** ExchangeRate-API: 無料・登録不要のエンドポイント（JPYベース） */
const EXCHANGE_RATE_API_URL =
  "https://open.er-api.com/v6/latest/JPY";

/** CoinGecko API: 暗号資産価格を JPY で取得 */
const COINGECKO_API_URL =
  "https://api.coingecko.com/api/v3/simple/price";

/** CoinGecko のコインID対応表（ティッカー → CoinGecko ID） */
const COINGECKO_ID_MAP: Partial<Record<CurrencyCode, string>> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  XRP: "ripple",
  USDT: "tether",
  USDC: "usd-coin",
  BNB: "binancecoin",
  ADA: "cardano",
};

// ===========================
// FinanceApiService クラス
// ===========================

export class FinanceApiService {
  private readonly aiClient: AIClient;

  constructor(aiClient?: AIClient) {
    this.aiClient = aiClient ?? new AIClient();
  }

  /**
   * 指定通貨リストの JPY 換算レートをまとめて取得する。
   * 法定通貨は ExchangeRate-API、暗号資産は CoinGecko から取得し、
   * 失敗した場合は AIClient による推論レートにフォールバックする。
   *
   * @param currencies - 取得対象の通貨コードセット
   * @returns RateMap（JPY は常に rate=1 で含まれる）
   */
  fetchRates(currencies: Set<CurrencyCode>): RateMap {
    const rateMap: RateMap = new Map();
    const now = new Date().toISOString();

    // JPY は常に 1:1
    rateMap.set("JPY", {
      from: "JPY",
      jpyRate: 1,
      source: "manual",
      fetchedAt: now,
      isEstimate: false,
    });

    // 対象通貨を法定通貨と暗号資産に分類
    const fiatCurrencies = new Set<CurrencyCode>();
    const cryptoCurrencies = new Set<CurrencyCode>();

    for (const currency of currencies) {
      if (currency === "JPY" || currency === "UNKNOWN") continue;
      if (COINGECKO_ID_MAP[currency]) {
        cryptoCurrencies.add(currency);
      } else {
        fiatCurrencies.add(currency);
      }
    }

    // --- 法定通貨レート取得 ---
    if (fiatCurrencies.size > 0) {
      try {
        this.fetchFiatRates(fiatCurrencies, rateMap, now);
      } catch (e) {
        console.warn("[FinanceApi] ExchangeRate-API 失敗。AI推論にフォールバック:", e);
        GasLogger.logError("ExchangeRate-API", e instanceof Error ? e.message : String(e));
        this.fetchRatesFromAI(fiatCurrencies, rateMap, now);
      }
    }

    // --- 暗号資産レート取得 ---
    if (cryptoCurrencies.size > 0) {
      try {
        this.fetchCryptoRates(cryptoCurrencies, rateMap, now);
      } catch (e) {
        console.warn("[FinanceApi] CoinGecko API 失敗。AI推論にフォールバック:", e);
        GasLogger.logError("CoinGecko-API", e instanceof Error ? e.message : String(e));
        this.fetchRatesFromAI(cryptoCurrencies, rateMap, now);
      }
    }

    // UNKNOWN は換算不能として rate=0 をセット
    if (currencies.has("UNKNOWN")) {
      rateMap.set("UNKNOWN", {
        from: "UNKNOWN",
        jpyRate: 0,
        source: "manual",
        fetchedAt: now,
        isEstimate: true,
      });
    }

    return rateMap;
  }

  // ===========================
  // 法定通貨: ExchangeRate-API
  // ===========================

  /**
   * ExchangeRate-API から法定通貨のレートを取得する。
   * レスポンスは JPY ベース（1 JPY = X 通貨）なので逆数を取る。
   */
  private fetchFiatRates(
    currencies: Set<CurrencyCode>,
    rateMap: RateMap,
    fetchedAt: string
  ): void {
    const response = UrlFetchApp.fetch(EXCHANGE_RATE_API_URL, {
      method: "get",
      muteHttpExceptions: true,
    });

    if (response.getResponseCode() !== 200) {
      throw new Error(`ExchangeRate-API HTTP ${response.getResponseCode()}`);
    }

    const data = JSON.parse(response.getContentText()) as {
      result?: string;
      rates?: Record<string, number>;
    };

    if (data.result !== "success" || !data.rates) {
      throw new Error("ExchangeRate-API: 不正なレスポンス形式");
    }

    // data.rates は "1 JPY = X 通貨" の形式 → 逆数で "1 通貨 = Y JPY" に変換
    for (const currency of currencies) {
      const rateFromJpy = data.rates[currency];
      if (rateFromJpy && rateFromJpy > 0) {
        rateMap.set(currency, {
          from: currency,
          jpyRate: 1 / rateFromJpy, // 1通貨 = ? JPY
          source: "exchangerate-api",
          fetchedAt,
          isEstimate: false,
        });
      }
    }
  }

  // ===========================
  // 暗号資産: CoinGecko API
  // ===========================

  /**
   * CoinGecko API から暗号資産の JPY 価格を取得する。
   */
  private fetchCryptoRates(
    currencies: Set<CurrencyCode>,
    rateMap: RateMap,
    fetchedAt: string
  ): void {
    // 対象コインのIDリストを構築
    const coinIds: string[] = [];
    const idToCurrency = new Map<string, CurrencyCode>();

    for (const currency of currencies) {
      const coinId = COINGECKO_ID_MAP[currency];
      if (coinId) {
        coinIds.push(coinId);
        idToCurrency.set(coinId, currency);
      }
    }

    if (coinIds.length === 0) return;

    const url = `${COINGECKO_API_URL}?ids=${coinIds.join(",")}&vs_currencies=jpy`;
    const response = UrlFetchApp.fetch(url, {
      method: "get",
      muteHttpExceptions: true,
    });

    if (response.getResponseCode() !== 200) {
      throw new Error(`CoinGecko API HTTP ${response.getResponseCode()}`);
    }

    const data = JSON.parse(response.getContentText()) as Record<
      string,
      { jpy?: number }
    >;

    for (const [coinId, currency] of idToCurrency) {
      const jpyPrice = data[coinId]?.jpy;
      if (jpyPrice && jpyPrice > 0) {
        rateMap.set(currency, {
          from: currency,
          jpyRate: jpyPrice,
          source: "coingecko",
          fetchedAt,
          isEstimate: false,
        });
      }
    }
  }

  // ===========================
  // フォールバック: AI推論レート
  // ===========================

  /**
   * 外部 API が失敗した場合に AIClient を使って概算レートを推論させる。
   *
   * ⚠️ このレートは AI の学習データに基づく推定値であり、
   * リアルタイムの市場レートではありません。投資判断に使用しないでください。
   */
  private fetchRatesFromAI(
    currencies: Set<CurrencyCode>,
    rateMap: RateMap,
    fetchedAt: string
  ): void {
    const currencyList = Array.from(currencies).join(", ");

    const systemPrompt = `
あなたは為替・金融の専門家です。
以下の通貨の対JPYレートの概算値を JSON 形式のみで返してください。
コードブロック記号や説明文は含めないこと。

出力形式:
{
  "rates": {
    "USD": 150,
    "EUR": 163
  },
  "disclaimer": "このレートはAIによる推定値です。リアルタイムデータではありません。"
}
`.trim();

    const userPrompt =
      `以下の通貨の対JPYレート（1通貨 = ?円）を概算で教えてください: ${currencyList}\n` +
      `現在の年: 2026年。最新の市場動向を反映した合理的な推定値を使用してください。`;

    try {
      const result = this.aiClient.generateContent(userPrompt, systemPrompt, {
        temperature: 0.1,
        maxOutputTokens: 512,
      });

      const cleaned = result.text
        .replace(/^```(?:json)?\s*/im, "")
        .replace(/\s*```\s*$/im, "")
        .trim();

      const parsed = JSON.parse(cleaned) as {
        rates?: Record<string, number>;
        disclaimer?: string;
      };

      if (!parsed.rates) throw new Error("AI推論: rates フィールドがありません");

      for (const currency of currencies) {
        const rate = parsed.rates[currency];
        if (rate && rate > 0) {
          rateMap.set(currency, {
            from: currency,
            jpyRate: rate,
            source: "ai-estimate",
            fetchedAt,
            isEstimate: true,
          });
          console.warn(
            `[FinanceApi] ${currency}: AI推論レート ${rate} JPY を使用中。⚠️ 推定値です。`
          );
        }
      }

      GasLogger.logSuccess(
        result.modelUsed,
        result.usageMetadata,
        `AI推論レート取得: ${currencyList}`
      );
    } catch (e) {
      GasLogger.logError("AI-Rate-Fallback", e instanceof Error ? e.message : String(e));
      // AI推論も失敗した場合は rate=0（換算不能）として扱う
      for (const currency of currencies) {
        if (!rateMap.has(currency)) {
          rateMap.set(currency, {
            from: currency,
            jpyRate: 0,
            source: "ai-estimate",
            fetchedAt,
            isEstimate: true,
          });
        }
      }
    }
  }

  /**
   * 資産リストから必要な通貨コードの Set を抽出するユーティリティ。
   */
  static extractCurrencies(
    assets: Array<{ currency: CurrencyCode }>
  ): Set<CurrencyCode> {
    return new Set(assets.map((a) => a.currency));
  }

  /**
   * JPY 換算額を計算する。
   * rate=0（換算不能）の場合は null を返す。
   */
  static calcJpyAmount(
    amount: number,
    rate: ExchangeRate | undefined
  ): number | null {
    if (!rate || rate.jpyRate === 0) return null;
    return Math.round(amount * rate.jpyRate);
  }
}
