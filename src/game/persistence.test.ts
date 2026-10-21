import { afterEach, describe, expect, it } from "vitest";
import { createNewCampaign } from "./simulation";
import { JOURNAL_VERSION, REPLAY_RULES_VERSION, readSave, SAVE_KEY, SAVE_VERSION, validateSave, verifyReplay, writeSave } from "./persistence";
const storage = globalThis as typeof globalThis & { localStorage: { clear(): void; setItem(key: string, value: string): void } };

describe("campaign persistence", () => {
  afterEach(() => storage.localStorage.clear());
  it("round-trips resolved state, reports, and event rail", () => {
    const game = createNewCampaign(77);
    const payload = { version: SAVE_VERSION, game, events: [{ turn: 1, message: "held" }], reports: [], rulesVersion: REPLAY_RULES_VERSION, journalVersion: JOURNAL_VERSION, journal: [] };
    expect(writeSave(payload)).toBeNull();
    expect(readSave()).toEqual(payload);
  });
  it("rejects corrupt, unsupported, non-finite, and invalid-reference saves", () => {
    expect(validateSave({})).toBe(false);
    expect(validateSave({ version: SAVE_VERSION + 1 })).toBe(false);
    const game = createNewCampaign(77);
    expect(validateSave({ version: 1, game: { ...game, resources: { ...game.resources, metal: Infinity } }, events: [], reports: [] })).toBe(false);
    expect(validateSave({ version: 1, game: { ...game, hq: { ...game.hq, player: "sector-999" } }, events: [], reports: [] })).toBe(false);
  });
  it("returns null for malformed stored JSON", () => {
    storage.localStorage.setItem(SAVE_KEY, "not-json");
    expect(readSave()).toBeNull();
  });
  it("accepts historical orders for a squad removed by casualties", () => {
    const game = createNewCampaign(77);
    const payload = { version: 1, game: { ...game, squads: game.squads.slice(1), orderHistory: [[{ squadId: "squad-1", type: "attack", target: "sector-1" as const }]] }, events: [], reports: [] };
    expect(validateSave(payload)).toBe(true);
    expect(validateSave({ ...payload, game: { ...payload.game, orderHistory: [[{ squadId: "not-a-campaign-squad", type: "attack", target: "sector-1" as const }]] } })).toBe(false);
  });
  it("rejects malformed nested battle report data", () => {
    const game = createNewCampaign(77);
    const report = { target: "sector-1", terrain: "ice", attackers: [], defenders: [], classAdvantages: [42], defenderCounters: [], terrainMultiplier: 1, fatiguePenalty: 0, variance: 0, attackerPower: 1, defenderPower: 1, winner: "draw", casualties: [], playerCasualties: 0, enemyCasualties: 0, retreat: [], captured: false, relayControlled: false };
    expect(validateSave({ version: SAVE_VERSION, game, events: [], reports: [report], rulesVersion: REPLAY_RULES_VERSION, journalVersion: JOURNAL_VERSION, journal: [] })).toBe(false);
  });
  it("validates persisted research, recent battles, routes, and terminal reason", () => {
    const game = createNewCampaign(77);
    const saved = { ...game, research: 2, researchLevels: { ...game.researchLevels, Signals: 2 }, recentBattles: ["sector-1"], scoutedEnemyRoutes: ["route:sector-1->sector-2"], terminal: "defeat" as const, terminalReason: "Turn 18 reached without victory." };
    expect(validateSave({ version: 1, game: saved, events: [], reports: [] })).toBe(true);
    expect(validateSave({ version: 1, game: { ...saved, scoutedEnemyRoutes: ["sector-999"] }, events: [], reports: [] })).toBe(true);
    expect(validateSave({ version: 1, game: { ...saved, terminalReason: 42 }, events: [], reports: [] })).toBe(false);
  });
  it("keeps legacy saves loadable but marks replay unavailable", () => {
    const game = createNewCampaign(77);
    const legacy = { version: 1, game, events: [], reports: [] };
    expect(validateSave(legacy)).toBe(true);
    expect(verifyReplay(legacy).status).toBe("unavailable");
  });
  it("replays accepted research and turns against the saved snapshot", () => {
    const game = createNewCampaign(77);
    const next = advanceResearchForTest(game);
    const turn = resolveTurnForTest(next);
    const payload = { version: SAVE_VERSION, game: turn.game, events: [], reports: turn.reports, rulesVersion: REPLAY_RULES_VERSION, journalVersion: JOURNAL_VERSION, journal: [{ type: "research" as const, branch: "Logistics" as const }, { type: "orders" as const, orders: [{ squadId: "squad-1", type: "hold" as const }] }] };
    expect(verifyReplay(payload)).toMatchObject({ status: "match" });
    expect(verifyReplay({ ...payload, game: { ...payload.game, turn: payload.game.turn + 1 } })).toMatchObject({ status: "mismatch" });
  });
  it("rejects malformed journal shapes", () => {
    const game = createNewCampaign(77);
    const baseline = { version: SAVE_VERSION, game, events: [], reports: [], rulesVersion: REPLAY_RULES_VERSION, journalVersion: JOURNAL_VERSION, journal: [] };
    expect(validateSave({ ...baseline, journalVersion: JOURNAL_VERSION + 1 })).toBe(true);
    expect(validateSave({ ...baseline, journal: [{ type: "orders", orders: [] }] })).toBe(false);
    expect(validateSave({ ...baseline, journal: [{ type: "orders", orders: [{ squadId: "squad-1", type: "hold" }, { squadId: "squad-1", type: "move" }] }] })).toBe(false);
    expect(verifyReplay({ ...baseline, journal: [{ type: "orders", orders: [{ squadId: "squad-1", type: "nonsense" as never }] }] })).toMatchObject({ status: "corrupt" });
  });
  it("loads valid campaigns with unsupported replay metadata", () => {
    const game = createNewCampaign(77);
    const payload = { version: SAVE_VERSION, game, events: [], reports: [], rulesVersion: 99, journalVersion: 99, journal: [] };
    expect(validateSave(payload)).toBe(true);
    expect(verifyReplay(payload).status).toBe("unsupported");
  });
  it("uses campaign journal limits and preserves historical squad ids", () => {
    const game = createNewCampaign(77);
    const order = { squadId: "squad-1", type: "hold" as const };
    const turns = Array.from({ length: 18 }, () => ({ type: "orders" as const, orders: [order] }));
    expect(validateSave({ version: SAVE_VERSION, game, events: [], reports: [], rulesVersion: REPLAY_RULES_VERSION, journalVersion: JOURNAL_VERSION, journal: turns })).toBe(true);
    expect(validateSave({ version: SAVE_VERSION, game, events: [], reports: [], rulesVersion: REPLAY_RULES_VERSION, journalVersion: JOURNAL_VERSION, journal: [...turns, turns[0]] })).toBe(false);
    expect(validateSave({ version: SAVE_VERSION, game, events: [], reports: [], rulesVersion: REPLAY_RULES_VERSION, journalVersion: JOURNAL_VERSION, journal: Array.from({ length: 7 }, () => ({ type: "research" as const, branch: "Logistics" as const })) })).toBe(false);
    expect(validateSave({ version: SAVE_VERSION, game, events: [], reports: [], rulesVersion: REPLAY_RULES_VERSION, journalVersion: JOURNAL_VERSION, journal: [{ type: "orders" as const, orders: Array.from({ length: 6 }, (_, index) => ({ squadId: `squad-${index + 1}`, type: "hold" as const })) }] })).toBe(false);
    expect(validateSave({ version: SAVE_VERSION, game, events: [], reports: [], rulesVersion: REPLAY_RULES_VERSION, journalVersion: JOURNAL_VERSION, journal: [{ type: "orders" as const, orders: [{ squadId: "squad-1", type: "hold" as const }] }] })).toBe(true);
  });
});

import { advanceResearch, resolveCombat, resolveEnemyTurn, resolveTurn } from "./simulation";
const advanceResearchForTest = (state: ReturnType<typeof createNewCampaign>) => advanceResearch(state, "Logistics");
const resolveTurnForTest = (state: ReturnType<typeof createNewCampaign>) => { const phase = resolveTurn(state, [{ squadId: "squad-1", type: "hold" }]); const combat = resolveCombat(phase.nextState, phase.events); const enemy = resolveEnemyTurn(combat.nextState); return { game: enemy.nextState, reports: [...combat.reports, ...enemy.reports] }; };
