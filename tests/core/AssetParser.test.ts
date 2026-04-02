/**
 * @file tests/core/AssetParser.test.ts
 * @description AssetParser のユニットテスト。
 * プロンプト生成・レスポンスパース・バリデーションを検証する。
 */

import {
  buildAssetSystemPrompt,
  buildAssetUserPrompt,
  parseAssetResponse,
  AssetExtractionResult,
} from "../../src/core/AssetParser";

// ===========================
// buildAssetSystemPrompt
// ===========================
describe("buildAssetSystemPrompt", () => {
  const prompt = buildAssetSystemPrompt();

  it("JSON スキーマが含まれている", () => {
    expect(prompt).toContain('"assets"');
    expect(prompt).toContain('"currency"');
    expect(prompt).toContain('"category"');
    expect(prompt).toContain('"identifier"');
  });

  it("JSON のみ出力するよう指示している", () => {
    expect(prompt).toContain("JSON 以外は絶対に出力しないこと");
  });

  it("セキュリティ警告が含まれている", () => {
    expect(prompt).toContain("パスワード・秘密鍵");
  });

  it("通貨コード変換テーブルが含まれている", () => {
    expect(prompt).toContain("JPY");
    expect(prompt).toContain("USD");
    expect(prompt).toContain("BTC");
  });
});

// ===========================
// buildAssetUserPrompt
// ===========================
describe("buildAssetUserPrompt", () => {
  it("生テキストが含まれる", () => {
    const prompt = buildAssetUserPrompt("三菱UFJ銀行 残高: ¥1,234,567");
    expect(prompt).toContain("三菱UFJ銀行");
  });
});

// ===========================
// parseAssetResponse
// ===========================
describe("parseAssetResponse", () => {
  const validResult: AssetExtractionResult = {
    assets: [
      {
        assetName: "三菱UFJ銀行 普通預金",
        amount: 1234567,
        currency: "JPY",
        category: "Cash",
        identifier: "mufg_futsuu",
        rawAmountText: "¥1,234,567",
      },
      {
        assetName: "Bitcoin",
        amount: 0.5,
        currency: "BTC",
        category: "Crypto",
        identifier: "btc_main",
        rawAmountText: "0.5 BTC",
      },
    ],
    sourceSummary: "銀行明細と暗号資産ウォレット",
    warnings: [],
  };

  it("正常な JSON をパースできる", () => {
    const result = parseAssetResponse(JSON.stringify(validResult));
    expect(result.assets).toHaveLength(2);
    expect(result.assets[0].currency).toBe("JPY");
    expect(result.assets[1].currency).toBe("BTC");
    expect(result.sourceSummary).toBe("銀行明細と暗号資産ウォレット");
  });

  it("Markdown コードブロックを除去してパースできる", () => {
    const withFence = "```json\n" + JSON.stringify(validResult) + "\n```";
    const result = parseAssetResponse(withFence);
    expect(result.assets).toHaveLength(2);
  });

  it("不正な JSON は Error をスローする", () => {
    expect(() => parseAssetResponse("not json")).toThrow("JSON パースに失敗");
  });

  it("スキーマ不一致は Error をスローする", () => {
    expect(() =>
      parseAssetResponse(JSON.stringify({ wrong: "schema" }))
    ).toThrow("スキーマと一致しません");
  });

  it("無効なカテゴリーは Other にフォールバックする", () => {
    const bad = {
      ...validResult,
      assets: [{ ...validResult.assets[0], category: "INVALID_CAT" }],
    };
    const result = parseAssetResponse(JSON.stringify(bad));
    expect(result.assets[0].category).toBe("Other");
  });

  it("無効な通貨コードは UNKNOWN にフォールバックする", () => {
    const bad = {
      ...validResult,
      assets: [{ ...validResult.assets[0], currency: "XYZ_UNKNOWN" }],
    };
    const result = parseAssetResponse(JSON.stringify(bad));
    expect(result.assets[0].currency).toBe("UNKNOWN");
  });

  it("負の amount は 0 に補正される", () => {
    const bad = {
      ...validResult,
      assets: [{ ...validResult.assets[0], amount: -100 }],
    };
    const result = parseAssetResponse(JSON.stringify(bad));
    expect(result.assets[0].amount).toBe(0);
  });

  it("identifier の重複は _2 サフィックスで解消される", () => {
    const duplicate = {
      ...validResult,
      assets: [
        { ...validResult.assets[0], identifier: "same_id" },
        { ...validResult.assets[1], identifier: "same_id" },
      ],
    };
    const result = parseAssetResponse(JSON.stringify(duplicate));
    expect(result.assets[0].identifier).toBe("same_id");
    expect(result.assets[1].identifier).toBe("same_id_2");
  });

  it("空の assets 配列でも正常にパースできる", () => {
    const empty = { assets: [], sourceSummary: "なし", warnings: [] };
    const result = parseAssetResponse(JSON.stringify(empty));
    expect(result.assets).toHaveLength(0);
  });

  it("warnings が配列として返される", () => {
    const withWarning = {
      ...validResult,
      warnings: ["通貨が不明な資産があります"],
    };
    const result = parseAssetResponse(JSON.stringify(withWarning));
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toBe("通貨が不明な資産があります");
  });

  it("文字列で渡された amount を数値に変換する", () => {
    const strAmount = {
      ...validResult,
      assets: [{ ...validResult.assets[0], amount: "1234567" as unknown as number }],
    };
    const result = parseAssetResponse(JSON.stringify(strAmount));
    expect(result.assets[0].amount).toBe(1234567);
  });
});
