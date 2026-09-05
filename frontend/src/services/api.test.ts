import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAccessToken,
  getAccessToken,
  getApiUrl,
  getPreferredAuthScope,
  setAccessToken,
} from "./api";

const values = new Map<string, string>();
const localStorageMock: Storage = {
  get length() { return values.size; },
  clear: () => values.clear(),
  getItem: (key) => values.get(key) ?? null,
  key: (index) => [...values.keys()][index] ?? null,
  removeItem: (key) => { values.delete(key); },
  setItem: (key, value) => { values.set(key, value); },
};

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });
beforeEach(() => values.clear());

describe("getApiUrl", () => {
  it("uses the configured default API origin", () => {
    expect(getApiUrl("/api/public/health")).toBe(
      "http://localhost:3000/api/public/health",
    );
  });
});

describe("account tokens", () => {
  it("keeps organizer and participant sessions in separate browser keys", () => {
    setAccessToken("organizer-token", "organizer");
    setAccessToken("participant-token", "participant");

    expect(getAccessToken("organizer")).toBe("organizer-token");
    expect(getAccessToken("participant")).toBe("participant-token");
    expect(getPreferredAuthScope()).toBe("participant");

    clearAccessToken("participant");
    expect(getAccessToken("participant")).toBeNull();
    expect(getAccessToken("organizer")).toBe("organizer-token");
    expect(getPreferredAuthScope()).toBe("organizer");
  });
});
