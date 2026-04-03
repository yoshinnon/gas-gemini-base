/**
 * @file tests/core/TaskExtractor.test.ts
 * @description TaskExtractor のユニットテスト。
 * プロンプト生成・レスポンスパース・バリデーションを検証する。
 */

import {
  buildSystemPrompt,
  buildUserPrompt,
  parseTaskResponse,
  TaskExtractionResult,
} from "../../src/core/TaskExtractor";

describe("buildSystemPrompt", () => {
  it("実行日が埋め込まれている", () => {
    const prompt = buildSystemPrompt("2025-07-01");
    expect(prompt).toContain("2025-07-01");
  });

  it("JSON スキーマが含まれている", () => {
    const prompt = buildSystemPrompt("2025-07-01");
    expect(prompt).toContain('"tasks"');
    expect(prompt).toContain('"dueDate"');
    expect(prompt).toContain('"priority"');
  });

  it("相対日付変換の指示が含まれている", () => {
    const prompt = buildSystemPrompt("2025-07-01");
    expect(prompt).toContain("来週月曜");
    expect(prompt).toContain("今週中");
  });

  it("JSON のみ出力するよう指示している", () => {
    const prompt = buildSystemPrompt("2025-07-01");
    expect(prompt).toContain("JSON 以外の文章");
  });
});

describe("buildUserPrompt", () => {
  it("議事録テキストが含まれる", () => {
    const prompt = buildUserPrompt("テスト議事録");
    expect(prompt).toContain("テスト議事録");
  });

  it("前後の空白がトリムされる", () => {
    const prompt = buildUserPrompt("  議事録  ");
    expect(prompt).toContain("議事録");
  });
});

describe("parseTaskResponse", () => {
  const validResponse: TaskExtractionResult = {
    tasks: [
      {
        title: "API設計書の作成",
        assignee: "田中",
        dueDate: "2025-07-07",
        priority: "HIGH",
        description: "REST API の設計書を Confluence に作成する",
      },
    ],
    summary: "API 設計の方向性を決定した",
    reason: "",
  };

  it("正常な JSON をパースできる", () => {
    const result = parseTaskResponse(JSON.stringify(validResponse));
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].title).toBe("API設計書の作成");
    expect(result.tasks[0].priority).toBe("HIGH");
    expect(result.summary).toBe("API 設計の方向性を決定した");
  });

  it("コードブロック記号（```json）を除去してパースできる", () => {
    const withFence = "```json\n" + JSON.stringify(validResponse) + "\n```";
    const result = parseTaskResponse(withFence);
    expect(result.tasks).toHaveLength(1);
  });

  it("tasks が空配列でも正常にパースできる", () => {
    const emptyResponse = {
      tasks: [],
      summary: "タスクなし",
      reason: "アクションアイテムが見当たらない",
    };
    const result = parseTaskResponse(JSON.stringify(emptyResponse));
    expect(result.tasks).toHaveLength(0);
    expect(result.reason).toBe("アクションアイテムが見当たらない");
  });

  it("不正な JSON は Error をスローする", () => {
    expect(() => parseTaskResponse("これはJSONではありません")).toThrow(
      "JSON パースに失敗"
    );
  });

  it("スキーマ不一致は Error をスローする", () => {
    expect(() =>
      parseTaskResponse(JSON.stringify({ invalid: "data" }))
    ).toThrow("スキーマと一致しません");
  });

  it("優先度が不正な場合は MEDIUM にフォールバックする", () => {
    const withInvalidPriority = {
      ...validResponse,
      tasks: [{ ...validResponse.tasks[0], priority: "CRITICAL" }],
    };
    const result = parseTaskResponse(JSON.stringify(withInvalidPriority));
    expect(result.tasks[0].priority).toBe("MEDIUM");
  });

  it("dueDate が ISO 形式でない場合は空文字になる", () => {
    const withBadDate = {
      ...validResponse,
      tasks: [{ ...validResponse.tasks[0], dueDate: "来週月曜" }],
    };
    const result = parseTaskResponse(JSON.stringify(withBadDate));
    expect(result.tasks[0].dueDate).toBe("");
  });

  it("dueDate が空文字の場合はそのまま空文字を返す", () => {
    const withEmptyDate = {
      ...validResponse,
      tasks: [{ ...validResponse.tasks[0], dueDate: "" }],
    };
    const result = parseTaskResponse(JSON.stringify(withEmptyDate));
    expect(result.tasks[0].dueDate).toBe("");
  });

  it("title が30文字を超える場合は50文字でカットされる", () => {
    const longTitle = "あ".repeat(60);
    const withLongTitle = {
      ...validResponse,
      tasks: [{ ...validResponse.tasks[0], title: longTitle }],
    };
    const result = parseTaskResponse(JSON.stringify(withLongTitle));
    expect(result.tasks[0].title.length).toBeLessThanOrEqual(50);
  });

  it("複数タスクを正しくパースできる", () => {
    const multiTaskResponse = {
      tasks: [
        {
          title: "タスク1",
          assignee: "鈴木",
          dueDate: "2025-07-10",
          priority: "HIGH",
          description: "説明1",
        },
        {
          title: "タスク2",
          assignee: "",
          dueDate: "",
          priority: "LOW",
          description: "説明2",
        },
      ],
      summary: "複数タスクのテスト",
      reason: "",
    };
    const result = parseTaskResponse(JSON.stringify(multiTaskResponse));
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[1].assignee).toBe("");
    expect(result.tasks[1].priority).toBe("LOW");
  });
});
