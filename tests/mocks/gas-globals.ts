/**
 * @file tests/mocks/gas-globals.ts
 * @description Jest テスト用に GAS グローバル API をモックする。
 * GAS 固有の API（UrlFetchApp, PropertiesService 等）はブラウザ/Node.js 環境に存在しないため。
 */

// =============================
// PropertiesService モック
// =============================
const mockProperties: Record<string, string> = {};

const mockScriptProperties = {
  getProperty: jest.fn((key: string) => mockProperties[key] ?? null),
  setProperty: jest.fn((key: string, value: string) => {
    mockProperties[key] = value;
  }),
  getProperties: jest.fn(() => ({ ...mockProperties })),
  deleteProperty: jest.fn((key: string) => {
    delete mockProperties[key];
  }),
};

(global as unknown as Record<string, unknown>).PropertiesService = {
  getScriptProperties: jest.fn(() => mockScriptProperties),
};

// =============================
// UrlFetchApp モック
// =============================
const mockResponse = {
  getResponseCode: jest.fn(() => 200),
  getContentText: jest.fn(() =>
    JSON.stringify({
      candidates: [
        {
          content: { parts: [{ text: "モックレスポンス" }] },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
      },
    })
  ),
};

(global as unknown as Record<string, unknown>).UrlFetchApp = {
  fetch: jest.fn(() => mockResponse),
};

// =============================
// SpreadsheetApp モック
// =============================
const mockSheet = {
  appendRow: jest.fn(),
  getRange: jest.fn(() => ({
    setValues: jest.fn(),
    setFontWeight: jest.fn(),
    setBackground: jest.fn(),
    setFontColor: jest.fn(),
  })),
  setFrozenRows: jest.fn(),
  autoResizeColumns: jest.fn(),
  getLastRow: jest.fn(() => 5),
};

const mockSpreadsheet = {
  getSheetByName: jest.fn(() => null), // デフォルトはシートなし
  insertSheet: jest.fn(() => mockSheet),
  addMenu: jest.fn(),
  setActiveSheet: jest.fn(),
};

(global as unknown as Record<string, unknown>).SpreadsheetApp = {
  getActiveSpreadsheet: jest.fn(() => mockSpreadsheet),
  getUi: jest.fn(() => ({
    alert: jest.fn(),
    ButtonSet: { OK: "OK" },
  })),
};

// =============================
// テストヘルパー
// =============================

/** PropertiesService にテスト用プロパティをセットする */
export function setMockProperty(key: string, value: string): void {
  mockProperties[key] = value;
}

/** PropertiesService のプロパティをクリアする */
export function clearMockProperties(): void {
  Object.keys(mockProperties).forEach((k) => delete mockProperties[k]);
}

/** UrlFetchApp のモックレスポンスを上書きする */
export function setMockFetchResponse(
  statusCode: number,
  body: Record<string, unknown>
): void {
  mockResponse.getResponseCode.mockReturnValue(statusCode);
  mockResponse.getContentText.mockReturnValue(JSON.stringify(body));
}

/** 全モックをリセットする */
export function resetAllMocks(): void {
  jest.clearAllMocks();
  clearMockProperties();
}

export { mockResponse, mockSpreadsheet, mockSheet };
