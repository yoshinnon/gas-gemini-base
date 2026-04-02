/**
 * @file tests/infra/Config.test.ts
 */

import "../mocks/gas-globals";
import {
  setMockProperty,
  clearMockProperties,
} from "../mocks/gas-globals";
import { Config, ConfigError } from "../../src/infra/Config";

describe("Config", () => {
  beforeEach(() => {
    clearMockProperties();
  });

  describe("getGeminiApiKey", () => {
    it("APIキーが設定されている場合、値を返す", () => {
      setMockProperty("GEMINI_API_KEY", "my-secret-key");
      expect(Config.getGeminiApiKey()).toBe("my-secret-key");
    });

    it("APIキーが未設定の場合、ConfigError をスローする", () => {
      expect(() => Config.getGeminiApiKey()).toThrow(ConfigError);
      expect(() => Config.getGeminiApiKey()).toThrow("Gemini API キーが設定されていません");
    });

    it("空白のみのAPIキーは未設定として扱う", () => {
      setMockProperty("GEMINI_API_KEY", "   ");
      expect(() => Config.getGeminiApiKey()).toThrow(ConfigError);
    });

    it("前後の空白はトリムされる", () => {
      setMockProperty("GEMINI_API_KEY", "  trimmed-key  ");
      expect(Config.getGeminiApiKey()).toBe("trimmed-key");
    });
  });

  describe("getLogSheetName", () => {
    it("未設定の場合、デフォルト値 'AI_Log' を返す", () => {
      expect(Config.getLogSheetName()).toBe("AI_Log");
    });

    it("設定されている場合、その値を返す", () => {
      setMockProperty("LOG_SHEET_NAME", "MyLog");
      expect(Config.getLogSheetName()).toBe("MyLog");
    });
  });
});
