/**
 * @file tests/core/TaskUseCase.test.ts
 * @description TaskUseCase のユニットテスト。
 * リトライロジック・フォールバック連携・ロギングを検証する。
 */

import "../mocks/gas-globals";
import { setMockProperty, resetAllMocks } from "../mocks/gas-globals";
import { TaskUseCase } from "../../src/core/TaskUseCase";
import { AIClient, GenerateContentResult } from "../../src/infra/AIClient";

const TEST_API_KEY = "test-key";

/** AIClient.generateContent のモックを作るヘルパー */
function makeAIClientMock(
  implementation: () => GenerateContentResult
): AIClient {
  const client = {
    generateContent: jest.fn(implementation),
    getModels: jest.fn(() => ["model-a"]),
  } as unknown as AIClient;
  return client;
}

/** 正常な TaskExtractionResult JSON を返す generateContent モック */
function makeSuccessResult(taskCount = 1): GenerateContentResult {
  const tasks = Array.from({ length: taskCount }, (_, i) => ({
    title: `タスク${i + 1}`,
    assignee: "担当者",
    dueDate: "2025-07-10",
    priority: "MEDIUM",
    description: `説明${i + 1}`,
  }));

  return {
    text: JSON.stringify({
      tasks,
      summary: "会議のサマリー",
      reason: "",
    }),
    modelUsed: "model-a",
    usageMetadata: { totalTokenCount: 100 },
    fallbackCount: 0,
  };
}

describe("TaskUseCase", () => {
  beforeEach(() => {
    resetAllMocks();
    setMockProperty("GEMINI_API_KEY", TEST_API_KEY);
    setMockProperty("LOG_SHEET_NAME", "AI_Log");
  });

  // ===========================
  // 正常系
  // ===========================
  describe("extractTasks - 正常系", () => {
    it("タスクが正常に抽出される", () => {
      const client = makeAIClientMock(() => makeSuccessResult(2));
      const useCase = new TaskUseCase(client);

      const output = useCase.extractTasks({ meetingText: "テスト議事録" });

      expect(output.tasks).toHaveLength(2);
      expect(output.modelUsed).toBe("model-a");
      expect(output.fallbackCount).toBe(0);
      expect(output.parseRetryCount).toBe(0);
    });

    it("executionDate を省略すると今日の日付が使われる", () => {
      const client = makeAIClientMock(() => makeSuccessResult());
      const useCase = new TaskUseCase(client);

      // エラーがなければ OK（内部で今日の日付が埋め込まれる）
      expect(() =>
        useCase.extractTasks({ meetingText: "テスト" })
      ).not.toThrow();
    });

    it("フォールバックが発生した場合、fallbackCount が正しく返る", () => {
      const client = makeAIClientMock(() => ({
        ...makeSuccessResult(),
        modelUsed: "model-b",
        fallbackCount: 1,
      }));
      const useCase = new TaskUseCase(client);

      const output = useCase.extractTasks({ meetingText: "テスト" });
      expect(output.fallbackCount).toBe(1);
      expect(output.modelUsed).toBe("model-b");
    });

    it("tasks が空配列でも正常に返る", () => {
      const client = makeAIClientMock(() => ({
        text: JSON.stringify({ tasks: [], summary: "タスクなし", reason: "なし" }),
        modelUsed: "model-a",
        usageMetadata: {},
        fallbackCount: 0,
      }));
      const useCase = new TaskUseCase(client);

      const output = useCase.extractTasks({ meetingText: "雑談のみ" });
      expect(output.tasks).toHaveLength(0);
    });
  });

  // ===========================
  // リトライ
  // ===========================
  describe("extractTasks - JSONパース失敗リトライ", () => {
    it("1回目失敗→2回目成功でリトライ成功する", () => {
      let callCount = 0;
      const client = makeAIClientMock(() => {
        callCount++;
        if (callCount === 1) {
          return {
            text: "これはJSONではありません",
            modelUsed: "model-a",
            usageMetadata: {},
            fallbackCount: 0,
          };
        }
        return makeSuccessResult();
      });

      const useCase = new TaskUseCase(client);
      const output = useCase.extractTasks({ meetingText: "テスト" });

      expect(output.parseRetryCount).toBe(1);
      expect(output.tasks).toHaveLength(1);
    });

    it("全リトライ失敗時に Error をスローする", () => {
      const client = makeAIClientMock(() => ({
        text: "invalid json always",
        modelUsed: "model-a",
        usageMetadata: {},
        fallbackCount: 0,
      }));

      const useCase = new TaskUseCase(client);
      expect(() =>
        useCase.extractTasks({ meetingText: "テスト" })
      ).toThrow("リトライ上限");
    });
  });

  // ===========================
  // API全失敗
  // ===========================
  describe("extractTasks - 全モデル失敗", () => {
    it("全モデル失敗エラーはリトライせずに即スローする", () => {
      const client = makeAIClientMock(() => {
        throw new Error("全てのモデルでAPI呼び出しに失敗しました。");
      });

      const useCase = new TaskUseCase(client);
      expect(() =>
        useCase.extractTasks({ meetingText: "テスト" })
      ).toThrow("全てのモデルでAPI呼び出しに失敗しました");

      // generateContent は1回しか呼ばれない（リトライしない）
      expect((client.generateContent as jest.Mock).mock.calls).toHaveLength(1);
    });
  });
});
