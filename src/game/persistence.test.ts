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
  it("accepts historical orders for a squad removed by casualties", () => {
    const game = createNewCampaign(77);
    const payload = { version: SAVE_VERSION, game: { ...game, squads: game.squads.slice(1), orderHistory: [[{ squadId: "squad-1", type: "attack", target: "sector-1" as const }]] }, events: [], reports: [] };
    expect(validateSave(payload)).toBe(true);
    expect(validateSave({ ...payload, game: { ...payload.game, orderHistory: [[{ squadId: "not-a-campaign-squad", type: "attack", target: "sector-1" as const }]] } })).toBe(false);
  });
  it("rejects malformed nested battle report data", () => {
    const game = createNewCampaign(77);
    const report = { target: "sector-1", terrain: "ice", attackers: [], defenders: [], classAdvantages: [42], defenderCounters: [], terrainMultiplier: 1, fatiguePenalty: 0, variance: 0, attackerPower: 1, defenderPower: 1, winner: "draw", casualties: [], playerCasualties: 0, enemyCasualties: 0, retreat: [], captured: false, relayControlled: false };
    expect(validateSave({ version: SAVE_VERSION, game, events: [], reports: [report] })).toBe(false);
  });
  it("validates persisted research, recent battles, routes, and terminal reason", () => {
    const game = createNewCampaign(77);
    const saved = { ...game, research: 2, researchLevels: { ...game.researchLevels, Signals: 2 }, recentBattles: ["sector-1"], scoutedEnemyRoutes: ["route:sector-1->sector-2"], terminal: "defeat" as const, terminalReason: "Turn 18 reached without victory." };
    expect(validateSave({ version: SAVE_VERSION, game: saved, events: [], reports: [] })).toBe(true);
    expect(validateSave({ version: SAVE_VERSION, game: { ...saved, scoutedEnemyRoutes: ["sector-999"] }, events: [], reports: [] })).toBe(true);
    expect(validateSave({ version: SAVE_VERSION, game: { ...saved, terminalReason: 42 }, events: [], reports: [] })).toBe(false);
  });
});
