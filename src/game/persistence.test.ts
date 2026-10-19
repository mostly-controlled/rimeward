import { afterEach, describe, expect, it } from "vitest";
import { createNewCampaign } from "./simulation";
import { readSave, SAVE_KEY, SAVE_VERSION, validateSave, writeSave } from "./persistence";
const storage = globalThis as typeof globalThis & { localStorage: { clear(): void; setItem(key: string, value: string): void } };

describe("campaign persistence", () => {
  afterEach(() => storage.localStorage.clear());
  it("round-trips resolved state, reports, and event rail", () => {
    const game = createNewCampaign(77);
    const payload = { version: SAVE_VERSION, game, events: [{ turn: 1, message: "held" }], reports: [] };
    expect(writeSave(payload)).toBeNull();
    expect(readSave()).toEqual(payload);
  });
  it("rejects corrupt, unsupported, non-finite, and invalid-reference saves", () => {
    expect(validateSave({})).toBe(false);
    expect(validateSave({ version: SAVE_VERSION + 1 })).toBe(false);
    const game = createNewCampaign(77);
    expect(validateSave({ version: SAVE_VERSION, game: { ...game, resources: { ...game.resources, metal: Infinity } }, events: [], reports: [] })).toBe(false);
    expect(validateSave({ version: SAVE_VERSION, game: { ...game, hq: { ...game.hq, player: "sector-999" } }, events: [], reports: [] })).toBe(false);
  });
  it("returns null for malformed stored JSON", () => {
    storage.localStorage.setItem(SAVE_KEY, "not-json");
    expect(readSave()).toBeNull();
  });
});
