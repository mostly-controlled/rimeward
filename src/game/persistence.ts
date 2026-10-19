import { createNewCampaign, type BattleReport, type GameState, type OrderType, type SectorId } from "./simulation";
declare const localStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void };

export const SAVE_KEY = "rimeward:campaign";
export const SAVE_VERSION = 1;
export type SavedView = { turn: number; message: string };
export type SavePayload = { version: number; game: GameState; events: SavedView[]; reports: BattleReport[] };

const finite = (value: unknown): boolean => {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finite);
  if (value && typeof value === "object") return Object.values(value).every(finite);
  return true;
};
const sectors = createNewCampaign(0).sectors;
const sectorIds = new Set<string>(sectors.map((sector) => sector.id));
const campaignSquadIds = new Set<string>(createNewCampaign(0).squads.map((squad) => squad.id));
const sectorRef = (value: unknown): value is SectorId => typeof value === "string" && sectorIds.has(value);
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const resource = (value: unknown) => isObject(value) && ["metal", "energy", "intelligence"].every((key) => typeof value[key] === "number" && Number.isFinite(value[key]));
const classes = new Set(["Sentinel", "Raider", "Recon", "Artillery"]);
const terrains = new Set(["ice", "ridge", "tundra", "crater"]);
const orders = new Set<OrderType>(["hold", "recover", "move", "attack"]);
const branches = ["Logistics", "Warfare", "Signals"];

export const validateSave = (value: unknown): value is SavePayload => {
  if (!isObject(value) || value.version !== SAVE_VERSION || !finite(value)) return false;
  const game = value.game;
  if (!isObject(game) || typeof game.seed !== "number" || !Number.isInteger(game.seed) || game.seed < 0 || typeof game.turn !== "number" || !Number.isInteger(game.turn) || game.turn < 1 || !["active", "victory", "defeat"].includes(String(game.terminal)) || !resource(game.resources) || !resource(game.income) || !Array.isArray(game.sectors) || game.sectors.length !== sectors.length || !Array.isArray(game.squads) || !Array.isArray(game.enemySquads) || !Array.isArray(game.objectives) || !Array.isArray(game.orderHistory) || !Array.isArray(game.enemyHistory)) return false;
  if (game.sectors.some((sector, index) => !isObject(sector) || sector.id !== sectors[index].id || !sectorRef(sector.id) || typeof sector.name !== "string" || !terrains.has(String(sector.terrain)) || !["player", "enemy", "neutral"].includes(String(sector.owner)) || !Array.isArray(sector.links) || sector.links.some((link) => !sectorRef(link)) || !resource(sector.yields))) return false;
  if (!isObject(game.hq) || !sectorRef(game.hq.player) || !sectorRef(game.hq.enemy) || game.squads.some((squad) => !isObject(squad) || typeof squad.id !== "string" || !classes.has(String(squad.class)) || !sectorRef(squad.home) || !sectorRef(squad.sector) || typeof squad.strength !== "number" || typeof squad.fatigue !== "number" || typeof squad.experience !== "number" || !Array.isArray(squad.upgrades)) || game.enemySquads.some((squad) => !isObject(squad) || typeof squad.id !== "string" || !classes.has(String(squad.class)) || !sectorRef(squad.sector) || typeof squad.strength !== "number") || game.objectives.some((objective) => !isObject(objective) || typeof objective.id !== "string" || !sectorRef(objective.sector) || typeof objective.controlled !== "boolean")) return false;

  if (game.orderHistory.some((turn) => !Array.isArray(turn) || turn.some((order) => !isObject(order) || !campaignSquadIds.has(String(order.squadId)) || !orders.has(order.type as OrderType) || (order.target !== undefined && !sectorRef(order.target))))) return false;
  const intent = (entry: unknown) => isObject(entry) && typeof entry.squadId === "string" && ["wait", "hold", "move", "attack"].includes(String(entry.kind)) && sectorRef(entry.from) && (entry.to === undefined || sectorRef(entry.to)) && (entry.target === undefined || sectorRef(entry.target));
  if (game.enemyHistory.some((entry) => !intent(entry)) || (game.strategicIntent !== undefined && !intent(game.strategicIntent)) || (game.strategicTarget !== undefined && (!isObject(game.strategicTarget) || typeof game.strategicTarget.squadId !== "string" || !sectorRef(game.strategicTarget.destination))) || typeof game.research !== "number" || !Number.isFinite(game.research) || !isObject(game.researchLevels) || branches.some((branch) => typeof (game.researchLevels as Record<string, unknown>)[branch] !== "number" || !Number.isFinite((game.researchLevels as Record<string, unknown>)[branch])) || !Array.isArray(game.recentBattles) || game.recentBattles.some((entry) => typeof entry !== "string") || !Array.isArray(game.revealedEnemySquads) || game.revealedEnemySquads.some((id) => typeof id !== "string") || !Array.isArray(game.scoutedEnemyRoutes) || game.scoutedEnemyRoutes.some((id) => typeof id !== "string") || (game.terminalReason !== undefined && typeof game.terminalReason !== "string") || typeof game.supplyCapacity !== "number" || !Number.isFinite(game.supplyCapacity)) return false;
  const squadView = (entry: unknown) => isObject(entry) && typeof entry.squadId === "string" && classes.has(String(entry.class)) && typeof entry.strength === "number" && Number.isFinite(entry.strength) && typeof entry.units === "number" && Number.isFinite(entry.units);
  const casualty = (entry: unknown) => isObject(entry) && typeof entry.squadId === "string" && ["player", "enemy"].includes(String(entry.side)) && typeof entry.strength === "number" && Number.isFinite(entry.strength);
  const report = (entry: unknown) => isObject(entry) && sectorRef(entry.target) && terrains.has(String(entry.terrain)) && ["player", "enemy", "draw"].includes(String(entry.winner)) && Array.isArray(entry.attackers) && entry.attackers.every(squadView) && Array.isArray(entry.defenders) && entry.defenders.every(squadView) && Array.isArray(entry.classAdvantages) && entry.classAdvantages.every((item) => typeof item === "string") && Array.isArray(entry.defenderCounters) && entry.defenderCounters.every((item) => typeof item === "string") && ["terrainMultiplier", "fatiguePenalty", "variance", "attackerPower", "defenderPower", "playerCasualties", "enemyCasualties"].every((key) => typeof entry[key] === "number" && Number.isFinite(entry[key])) && Array.isArray(entry.casualties) && entry.casualties.every(casualty) && Array.isArray(entry.retreat) && entry.retreat.every((item) => isObject(item) && typeof item.squadId === "string" && sectorRef(item.to)) && typeof entry.captured === "boolean" && typeof entry.relayControlled === "boolean";
  return Array.isArray(value.events) && value.events.every((event) => isObject(event) && typeof event.turn === "number" && Number.isFinite(event.turn) && typeof event.message === "string") && Array.isArray(value.reports) && value.reports.every(report);
};
export const readSave = (): SavePayload | null => { try { const raw = localStorage.getItem(SAVE_KEY); return raw ? ((() => { const parsed: unknown = JSON.parse(raw); return validateSave(parsed) ? parsed : null; })()) : null; } catch { return null; } };
export const readSaveNotice = (): string => { try { const raw = localStorage.getItem(SAVE_KEY); return raw && !readSave() ? "SAVE RESET — the stored campaign was corrupt or unsupported; a fresh campaign is ready." : ""; } catch { return "SAVE UNAVAILABLE — browser storage is blocked; this campaign may not survive reload."; } };
export const writeSave = (payload: SavePayload): string | null => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(payload)); return null; } catch { return "SAVE UNAVAILABLE — browser storage is blocked or full; this campaign may not survive reload."; } };
