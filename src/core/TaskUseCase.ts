/**
 * @file src/core/TaskUseCase.ts
 * @description タスク抽出のユースケース層。
 * AIClient を通じた API 呼び出し・JSON パース失敗時のリトライ・ロギングを統括する。
 *
 * 責務:
 * - AIClient.generateContent() の呼び出し（フォールバックは AIClient が担当）
 * - parseTaskResponse のリトライ（JSON パース失敗時のみ再試行）
 * - 成功・失敗・フォールバックのビジネスレベルロギング
 */

import { AIClient } from "../infra/AIClient";
import { GasLogger } from "../infra/Logger";
import {
  Task,
  TaskExtractionResult,
  buildSystemPrompt,
  buildUserPrompt,
  parseTaskResponse,
} from "./TaskExtractor";

// ===========================
// 設定定数
// ===========================

/** JSON パース失敗時の最大リトライ回数 */
const MAX_PARSE_RETRIES = 2;

/** リトライ時に追加するフィードバックプロンプト */
const RETRY_FEEDBACK =
  "\n\n【重要な修正指示】前回の出力は有効な JSON ではありませんでした。" +
  "今度は JSON のみを出力し、コードブロック記号（```）や説明文を一切含めないでください。";

// ===========================
// ユースケース入出力型
// ===========================

/** タスク抽出ユースケースの入力 */
export interface ExtractTasksInput {
  /** 議事録テキスト */
  meetingText: string;
  /** 実行日（YYYY-MM-DD）。省略時は今日の日付を使用 */
  executionDate?: string;
}

/** タスク抽出ユースケースの出力 */
export interface ExtractTasksOutput {
  tasks: Task[];
  summary: string;
  /** 使用されたモデル名 */
  modelUsed: string;
  /** フォールバック回数（0 = フォールバックなし） */
  fallbackCount: number;
  /** パースリトライ回数（0 = 一発成功） */
  parseRetryCount: number;
  /** 消費トークン数 */
  totalTokens: number | null;
}

// ===========================
// TaskUseCase クラス
// ===========================

export class TaskUseCase {
  private readonly client: AIClient;

  constructor(client?: AIClient) {
    // 外部から AIClient を注入できるようにする（テスト容易性・DI）
    this.client = client ?? new AIClient();
  }

  /**
   * 議事録テキストからタスクを抽出する。
   *
   * @param input - 抽出入力（議事録テキスト・実行日）
   * @returns 抽出されたタスクリストとメタ情報
   * @throws Error - 全モデル失敗 or リトライ上限超過
   */
  extractTasks(input: ExtractTasksInput): ExtractTasksOutput {
    const executionDate = input.executionDate ?? TaskUseCase.getTodayIso();

    const systemPrompt = buildSystemPrompt(executionDate);
    const baseUserPrompt = buildUserPrompt(input.meetingText);

    let currentUserPrompt = baseUserPrompt;
    let parseRetryCount = 0;
    let lastError: Error | null = null;

    // JSON パース失敗時のリトライループ
    // 注意: モデルレベルのフォールバック（429等）は AIClient が内部で処理する
    for (let attempt = 0; attempt <= MAX_PARSE_RETRIES; attempt++) {
      let aiResult: ReturnType<AIClient["generateContent"]> | null = null;

      try {
        // --- Step 1: AI API 呼び出し ---
        aiResult = this.client.generateContent(
          currentUserPrompt,
          systemPrompt,
          {
            temperature: 0.1,      // 構造化出力のため低温度（決定論的に近い）
            maxOutputTokens: 4096, // タスクが多い場合に備えてトークン上限を確保
          }
        );

        // --- Step 2: JSON パース ---
        const extracted: TaskExtractionResult = parseTaskResponse(aiResult.text);

        // --- Step 3: 成功ロギング ---
        const logMessage = TaskUseCase.buildSuccessLogMessage(
          extracted,
          aiResult.modelUsed,
          aiResult.fallbackCount,
          parseRetryCount
        );
        GasLogger.logSuccess(aiResult.modelUsed, aiResult.usageMetadata, logMessage);

        return {
          tasks: extracted.tasks,
          summary: extracted.summary,
          modelUsed: aiResult.modelUsed,
          fallbackCount: aiResult.fallbackCount,
          parseRetryCount,
          totalTokens: aiResult.usageMetadata.totalTokenCount ?? null,
        };
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));

        // API 呼び出し自体の失敗（全モデル失敗）はリトライしない
        if (TaskUseCase.isApiFailure(lastError.message)) {
          GasLogger.logError("ALL_MODELS", lastError.message);
          throw lastError;
        }

        // JSON パース失敗 → リトライ
        if (attempt < MAX_PARSE_RETRIES) {
          parseRetryCount++;
          const modelLabel = aiResult?.modelUsed ?? "不明";
          console.warn(
            `[TaskUseCase] JSONパース失敗 (attempt ${attempt + 1}/${MAX_PARSE_RETRIES + 1}), ` +
              `モデル: ${modelLabel}。リトライします...`
          );
          GasLogger.logError(
            modelLabel,
            `JSONパース失敗 (attempt ${attempt + 1}): ${lastError.message}`
          );
          // リトライ時のプロンプトにフィードバックを追加
          currentUserPrompt = baseUserPrompt + RETRY_FEEDBACK;
        }
      }
    }

    // リトライ上限超過
    const finalMsg = `JSONパース失敗がリトライ上限(${MAX_PARSE_RETRIES}回)を超えました: ${lastError?.message ?? "不明"}`;
    GasLogger.logError("PARSE_RETRY_EXCEEDED", finalMsg);
    throw new Error(finalMsg);
  }

  // ===========================
  // プライベートユーティリティ
  // ===========================

  /** 今日の日付を YYYY-MM-DD 形式で返す */
  private static getTodayIso(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  /** エラーメッセージが API 呼び出し失敗（全モデル失敗）かを判定する */
  private static isApiFailure(message: string): boolean {
    return message.includes("全てのモデルでAPI呼び出しに失敗しました");
  }

  /** 成功時ログメッセージを組み立てる */
  private static buildSuccessLogMessage(
    result: TaskExtractionResult,
    modelUsed: string,
    fallbackCount: number,
    parseRetryCount: number
  ): string {
    const parts: string[] = [
      `タスク抽出成功: ${result.tasks.length}件`,
      `使用モデル: ${modelUsed}`,
    ];
    if (fallbackCount > 0) {
      parts.push(`フォールバック: ${fallbackCount}回`);
    }
    if (parseRetryCount > 0) {
      parts.push(`パースリトライ: ${parseRetryCount}回`);
    }
    return parts.join(" | ");
  }
}
