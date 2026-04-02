/**
 * @file tests/infra/AIClient.test.ts
 * @description AIClient のユニットテスト。
 * フォールバックロジック・エラーハンドリングを重点的にテストする。
 */

import {
  setMockProperty,
  resetAllMocks,
  setMockFetchResponse,
} from "../mocks/gas-globals";

// GAS グローバルを先にモック
import "../mocks/gas-globals";

import { AIClient, MODEL_PRIORITY } from "../../src/infra/AIClient";

const TEST_API_KEY = "test-api-key-12345";

describe("AIClient", () => {
  beforeEach(() => {
    resetAllMocks();
    setMockProperty("GEMINI_API_KEY", TEST_API_KEY);
  });

  // ===========================
  // コンストラクタ
  // ===========================
  describe("constructor", () => {
    it("APIキーが設定されている場合、正常にインスタンス化できる", () => {
      expect(() => new AIClient()).not.toThrow();
    });

    it("APIキーが未設定の場合、ConfigError をスローする", () => {
      resetAllMocks(); // プロパティをクリア
      expect(() => new AIClient()).toThrow("Gemini API キーが設定されていません");
    });

    it("空のモデルリストを渡した場合、エラーをスローする", () => {
      expect(() => new AIClient([])).toThrow(
        "モデルリストが空です"
      );
    });

    it("カスタムモデルリストで初期化できる", () => {
      const client = new AIClient(["custom-model"]);
      expect(client.getModels()).toEqual(["custom-model"]);
    });

    it("デフォルトモデルリストは MODEL_PRIORITY と一致する", () => {
      const client = new AIClient();
      expect(client.getModels()).toEqual(MODEL_PRIORITY);
    });
  });

  // ===========================
  // generateContent - 正常系
  // ===========================
  describe("generateContent - 正常系", () => {
    it("最優先モデルが成功した場合、そのモデルの結果を返す", () => {
      const client = new AIClient(["model-a", "model-b"]);
      const result = client.generateContent("テストプロンプト");

      expect(result.text).toBe("モックレスポンス");
      expect(result.modelUsed).toBe("model-a");
      expect(result.fallbackCount).toBe(0);
    });

    it("usageMetadata が正しく返される", () => {
      const client = new AIClient();
      const result = client.generateContent("テスト");

      expect(result.usageMetadata.promptTokenCount).toBe(10);
      expect(result.usageMetadata.candidatesTokenCount).toBe(5);
      expect(result.usageMetadata.totalTokenCount).toBe(15);
    });
  });

  // ===========================
  // generateContent - フォールバック
  // ===========================
  describe("generateContent - フォールバック", () => {
    it("429エラーで次のモデルへフォールバックする", () => {
      // 最初の呼び出しは429、2回目は成功
      const fetchMock = (
        global as unknown as Record<string, { fetch: jest.Mock }>
      ).UrlFetchApp.fetch as jest.Mock;

      fetchMock
        .mockReturnValueOnce({
          getResponseCode: () => 429,
          getContentText: () =>
            JSON.stringify({ error: { code: 429, message: "RATE_LIMIT", status: "RESOURCE_EXHAUSTED" } }),
        })
        .mockReturnValueOnce({
          getResponseCode: () => 200,
          getContentText: () =>
            JSON.stringify({
              candidates: [
                { content: { parts: [{ text: "フォールバック成功" }] } },
              ],
              usageMetadata: { totalTokenCount: 20 },
            }),
        });

      const client = new AIClient(["model-first", "model-second"]);
      const result = client.generateContent("テスト");

      expect(result.text).toBe("フォールバック成功");
      expect(result.modelUsed).toBe("model-second");
      expect(result.fallbackCount).toBe(1);
    });

    it("503エラーでもフォールバックする", () => {
      const fetchMock = (
        global as unknown as Record<string, { fetch: jest.Mock }>
      ).UrlFetchApp.fetch as jest.Mock;

      fetchMock
        .mockReturnValueOnce({
          getResponseCode: () => 503,
          getContentText: () => JSON.stringify({ error: { code: 503, message: "Service Unavailable", status: "UNAVAILABLE" } }),
        })
        .mockReturnValueOnce({
          getResponseCode: () => 200,
          getContentText: () =>
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: "成功" }] } }],
              usageMetadata: {},
            }),
        });

      const client = new AIClient(["model-a", "model-b"]);
      const result = client.generateContent("テスト");
      expect(result.fallbackCount).toBe(1);
    });

    it("全モデル失敗時に Error をスローする", () => {
      setMockFetchResponse(429, {
        error: { code: 429, message: "RATE_LIMIT", status: "RESOURCE_EXHAUSTED" },
      });

      const client = new AIClient(["model-a", "model-b"]);
      expect(() => client.generateContent("テスト")).toThrow(
        "全てのモデルでAPI呼び出しに失敗しました"
      );
    });
  });

  // ===========================
  // buildEndpoint
  // ===========================
  describe("buildEndpoint", () => {
    it("正しいエンドポイントURLを生成する", () => {
      const url = AIClient.buildEndpoint("gemini-2.5-flash", "my-key");
      expect(url).toContain("gemini-2.5-flash");
      expect(url).toContain("key=my-key");
      expect(url).toContain("generateContent");
    });
  });

  // ===========================
  // モデルリストの疎結合性
  // ===========================
  describe("モデルリストの疎結合性", () => {
    it("カスタムモデルリストで動作する（疎結合の確認）", () => {
      const customModels = ["model-x", "model-y", "model-z"];
      const client = new AIClient(customModels);
      expect(client.getModels()).toEqual(customModels);
      expect(client.getModels()).not.toBe(customModels); // 参照コピー確認
    });
  });
});
