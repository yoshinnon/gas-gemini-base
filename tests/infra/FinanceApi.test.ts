/**
 * @file tests/infra/FinanceApi.test.ts
 * @description FinanceApiService のユニットテスト。
 * 通貨分類・JPY換算計算・AI推論フォールバックを検証する。
 */

import "../mocks/gas-globals";
import { resetAllMocks, setMockProperty } from "../mocks/gas-globals";
import { FinanceApiService } from "../../src/infra/FinanceApi";
import { CurrencyCode } from "../../src/core/AssetParser";

describe("FinanceApiService", () => {
  beforeEach(() => {
    resetAllMocks();
    setMockProperty("GEMINI_API_KEY", "test-key");
    setMockProperty("LOG_SHEET_NAME", "AI_Log");
  });

  // ===========================
  // extractCurrencies
  // ===========================
  describe("extractCurrencies", () => {
    it("資産リストから通貨コードを抽出する", () => {
      const assets = [
        { currency: "JPY" as CurrencyCode },
        { currency: "USD" as CurrencyCode },
        { currency: "BTC" as CurrencyCode },
        { currency: "USD" as CurrencyCode }, // 重複
      ];
      const result = FinanceApiService.extractCurrencies(assets);
      expect(result.size).toBe(3);
      expect(result.has("JPY")).toBe(true);
      expect(result.has("USD")).toBe(true);
      expect(result.has("BTC")).toBe(true);
    });

    it("空配列は空の Set を返す", () => {
      const result = FinanceApiService.extractCurrencies([]);
      expect(result.size).toBe(0);
    });
  });

  // ===========================
  // calcJpyAmount
  // ===========================
  describe("calcJpyAmount", () => {
    it("USD: 1 USD = 150 JPY として換算する", () => {
      const rate = {
        from: "USD" as CurrencyCode,
        jpyRate: 150,
        source: "exchangerate-api" as const,
        fetchedAt: new Date().toISOString(),
        isEstimate: false,
      };
      expect(FinanceApiService.calcJpyAmount(100, rate)).toBe(15000);
    });

    it("JPY は換算なし（rate=1）", () => {
      const rate = {
        from: "JPY" as CurrencyCode,
        jpyRate: 1,
        source: "manual" as const,
        fetchedAt: new Date().toISOString(),
        isEstimate: false,
      };
      expect(FinanceApiService.calcJpyAmount(1000000, rate)).toBe(1000000);
    });

    it("rate=0（換算不能）は null を返す", () => {
      const rate = {
        from: "UNKNOWN" as CurrencyCode,
        jpyRate: 0,
        source: "manual" as const,
        fetchedAt: new Date().toISOString(),
        isEstimate: true,
      };
      expect(FinanceApiService.calcJpyAmount(100, rate)).toBeNull();
    });

    it("rate が undefined の場合は null を返す", () => {
      expect(FinanceApiService.calcJpyAmount(100, undefined)).toBeNull();
    });

    it("小数点以下は四捨五入される", () => {
      const rate = {
        from: "USD" as CurrencyCode,
        jpyRate: 149.9,
        source: "exchangerate-api" as const,
        fetchedAt: new Date().toISOString(),
        isEstimate: false,
      };
      // 1 * 149.9 = 149.9 → round → 150
      expect(FinanceApiService.calcJpyAmount(1, rate)).toBe(150);
    });

    it("BTC: 1 BTC = 15,000,000 JPY として換算する", () => {
      const rate = {
        from: "BTC" as CurrencyCode,
        jpyRate: 15000000,
        source: "coingecko" as const,
        fetchedAt: new Date().toISOString(),
        isEstimate: false,
      };
      expect(FinanceApiService.calcJpyAmount(0.5, rate)).toBe(7500000);
    });
  });
});
