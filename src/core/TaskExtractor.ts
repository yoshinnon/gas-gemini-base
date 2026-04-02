/**
 * @file src/core/TaskExtractor.ts
 * @description 議事録からタスクを抽出するドメインモデルとプロンプト設計。
 *
 * 設計方針:
 * - Task インターフェースはドメインの純粋な表現（インフラ非依存）
 * - System Instruction で JSON スキーマを厳密に強制
 * - 日本語特有の曖昧表現・敬語・相対日付を正しく解釈させるプロンプト工夫
 */

// ===========================
// ドメインモデル
// ===========================

/** タスクの優先度 */
export type TaskPriority = "HIGH" | "MEDIUM" | "LOW";

/** タスク1件を表すドメインオブジェクト */
export interface Task {
  /** タスクのタイトル（簡潔な1行サマリー） */
  title: string;
  /** 担当者名（不明な場合は空文字） */
  assignee: string;
  /**
   * 期限（ISO 8601 形式: YYYY-MM-DD）。
   * 「来週月曜」などの相対表現はプロンプトで実行日基準に変換させる。
   * 期限の記述がない場合は空文字。
   */
  dueDate: string;
  /** 優先度 */
  priority: TaskPriority;
  /** タスクの詳細説明・背景・完了条件 */
  description: string;
}

/** AI からのレスポンス全体を表す型 */
export interface TaskExtractionResult {
  tasks: Task[];
  /** 議事録のサマリー（補助情報として取得） */
  summary: string;
  /** 抽出できなかった理由（タスクが0件の場合） */
  reason?: string;
}

// ===========================
// JSON スキーマ定義（プロンプト埋め込み用）
// ===========================

/** AI に返させる JSON の厳密なスキーマ定義文字列 */
const JSON_SCHEMA = `
{
  "tasks": [
    {
      "title": "string — タスクの簡潔なタイトル（30文字以内）",
      "assignee": "string — 担当者名（不明・未定の場合は空文字 \"\"）",
      "dueDate": "string — ISO 8601 形式の日付 YYYY-MM-DD（期限なしの場合は空文字 \"\"）",
      "priority": "string — 必ず HIGH / MEDIUM / LOW のいずれか",
      "description": "string — タスクの詳細説明・背景・完了条件（200文字以内）"
    }
  ],
  "summary": "string — 会議全体の要約（100文字以内）",
  "reason": "string — tasks が空配列の場合のみ理由を記載、それ以外は空文字 \"\""
}
`.trim();

// ===========================
// プロンプト生成
// ===========================

/**
 * タスク抽出用システムプロンプトを生成する。
 * 実行日を受け取り、相対日付の基準点として埋め込む。
 *
 * @param executionDate - 実行日（YYYY-MM-DD 形式）。相対日付変換の基準。
 */
export function buildSystemPrompt(executionDate: string): string {
  return `
あなたは会議議事録からアクションアイテムを抽出する専門アシスタントです。

## あなたの役割
与えられた会議メモ・議事録を精読し、参加者が「やること」と認識しているタスクをすべて漏れなく抽出します。

## 出力形式（厳守）
- 必ず以下の JSON スキーマのみを出力すること。
- JSON 以外の文章・説明・Markdown コードブロック（\`\`\`）は一切含めないこと。
- 配列の要素数はタスク件数に応じて増減してよい（0件の場合は空配列）。

${JSON_SCHEMA}

## 抽出ルール

### 1. タスクの認定基準
以下のいずれかに該当する発言・記述はタスクとして抽出する:
- 「〜してください」「〜をお願いします」「〜しておきます」
- 「〜することになりました」「〜を検討します」「〜を確認します」
- 「〜までに〜を提出」「〜の件は〜さんが対応」
- 「TODO」「Action Item」「宿題」「持ち帰り」

### 2. 担当者の特定
- 名前・役職・チーム名が明記されていれば assignee に記載する。
- 「自分で対応」「私が」などの一人称は、発言者が明記されていればその人名を使う。
- 誰が担当するか不明・未定の場合は assignee を空文字にする（「未定」は書かない）。

### 3. 期限の変換ルール（重要）
本日の実行日: **${executionDate}**

| 表現例 | 変換方法 |
|--------|---------|
| 「来週月曜」 | 実行日の翌週月曜日の日付 |
| 「今週中」 | 実行日が属する週の金曜日 |
| 「月末」 | 実行日が属する月の末日 |
| 「3日以内」「〜日まで」 | 実行日から計算した具体的な日付 |
| 「今日中」「本日」 | 実行日そのもの（${executionDate}） |
| 期限の記載なし | 空文字 "" |

### 4. 優先度の判定
- **HIGH**: 緊急・今日中・クリティカルパス・経営判断に関わる・締め切りが直近
- **MEDIUM**: 今週〜来週内・通常業務の進捗に影響
- **LOW**: 来週以降・調査・確認事項・情報共有

### 5. 日本語特有の表現
- 敬語（「〜していただけますか」「〜をご確認ください」）はタスクとして認定する。
- 「〜かもしれません」「〜を考えています」は意思が不確定なためタスクにしない。
- 「〜という話もありました」「〜という意見が出ました」は議題であり、具体的なアクションが伴わなければタスクにしない。
- 重複する内容は1件に統合すること。

## 重要
- JSON 以外は絶対に出力しないこと（前置き・後書き・コードブロック記号も不要）。
- スキーマの全フィールドを必ず含めること（省略不可）。
`.trim();
}

/**
 * タスク抽出用ユーザープロンプトを生成する。
 *
 * @param meetingText - 議事録・会議メモのテキスト
 */
export function buildUserPrompt(meetingText: string): string {
  return `
以下の会議メモからタスクを抽出し、指定の JSON 形式で出力してください。

---
${meetingText.trim()}
---
`.trim();
}

// ===========================
// レスポンスパーサー
// ===========================

/**
 * AI からのレスポンステキストを TaskExtractionResult にパースする。
 * JSON ブロック記号（\`\`\`json など）が混入していても除去して試みる。
 *
 * @throws Error - JSON パースに失敗した場合
 */
export function parseTaskResponse(rawText: string): TaskExtractionResult {
  // Markdown コードブロックの除去（モデルが指示を守らない場合への防御）
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```\s*$/im, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `AI レスポンスの JSON パースに失敗しました。\n受信テキスト（先頭200文字）:\n${rawText.slice(0, 200)}`
    );
  }

  // 型ガード
  if (!isTaskExtractionResult(parsed)) {
    throw new Error(
      `AI レスポンスが期待するスキーマと一致しません。\n受信データ: ${JSON.stringify(parsed).slice(0, 200)}`
    );
  }

  // tasks 配列の各要素をバリデーション・サニタイズ
  const validatedTasks: Task[] = parsed.tasks.map((task, index) =>
    validateAndSanitizeTask(task, index)
  );

  return {
    tasks: validatedTasks,
    summary: String(parsed.summary ?? ""),
    reason: parsed.reason ? String(parsed.reason) : undefined,
  };
}

/** TaskExtractionResult の型ガード */
function isTaskExtractionResult(value: unknown): value is {
  tasks: unknown[];
  summary: unknown;
  reason?: unknown;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "tasks" in value &&
    Array.isArray((value as Record<string, unknown>).tasks) &&
    "summary" in value
  );
}

/** Task 1件をバリデーション・サニタイズして返す */
function validateAndSanitizeTask(raw: unknown, index: number): Task {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`tasks[${index}] がオブジェクトではありません: ${JSON.stringify(raw)}`);
  }

  const r = raw as Record<string, unknown>;

  const priority = String(r.priority ?? "MEDIUM").toUpperCase();
  const validPriority: TaskPriority =
    priority === "HIGH" || priority === "LOW" ? priority : "MEDIUM";

  return {
    title: String(r.title ?? `タスク ${index + 1}`).slice(0, 50),
    assignee: String(r.assignee ?? ""),
    dueDate: sanitizeDueDate(String(r.dueDate ?? "")),
    priority: validPriority,
    description: String(r.description ?? "").slice(0, 300),
  };
}

/** dueDate が ISO 8601 形式かチェックし、不正な場合は空文字にする */
function sanitizeDueDate(value: string): string {
  if (!value) return "";
  // YYYY-MM-DD 形式かチェック
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}
