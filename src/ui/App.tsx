import { useEffect, useMemo, useState } from "react";
import {
  advanceResearch,
  calculateIncome,
  connectedOwnedSectors,
  createNewCampaign,
  researchCost,
  resolveCombat,
  resolveEnemyTurn,
  resolveTurn,
  recoveryMetalCost,
  type BattleReport,
  type GameState,
  type Order,
  type OrderType,
  type ResearchBranch,
  type SectorId,
} from "../game/simulation";
import {
  readSave,
  readSaveNotice,
  SAVE_VERSION,
  writeSave,
} from "../game/persistence";

type RailEvent = { turn: number; message: string };

const queuedCost = (orders: Order[], state: GameState) =>
  orders.reduce(
    (total, order) => ({
      metal:
        total.metal +
        (order.type === "attack"
          ? 2
          : order.type === "recover"
            ? recoveryMetalCost(state)
            : 0),
      energy:
        total.energy +
        (order.type === "attack" ? 3 : order.type === "recover" ? 2 : 0),
    }),
    { metal: 0, energy: 0 },
  );

const SEED = 42024;
const SAVE_SUCCESS =
  "Completed turns and research saved; queued orders are not saved.";
const researchEffect = (branch: ResearchBranch, level: number) =>
  ({
    Logistics: [
      "Strength/supply cap 12 · recovery +1",
      "Strength/supply cap 14 · recovery +2",
    ],
    Warfare: [
      "Counter matchups +5% · fortification +5%",
      "Counter matchups +10% · fortification +10%",
    ],
    Signals: [
      "Reveal hostile identities and sectors",
      "Reveal hostile identities, sectors, and routes",
    ],
  })[branch][Math.max(0, Math.min(level - 1, 1))];
export const battleOutcomeLabel = (report: Pick<BattleReport, "winner" | "captured">) =>
  report.winner === "draw"
    ? "contested, no capture"
    : report.winner === "player"
      ? report.captured
        ? "captured"
        : "won; not captured"
      : "lost";
const squadLabel = (squad: { class: string; id: string }) =>
  `${squad.class} ${squad.id.replace(/^squad-/, "#")}`;
const pos: Record<string, [number, number]> = {
  "sector-0": [95, 170],
  "sector-1": [180, 95],
  "sector-2": [285, 75],
  "sector-3": [390, 115],
  "sector-4": [495, 75],
  "sector-5": [595, 145],
  "sector-6": [690, 205],
  "sector-7": [610, 295],
  "sector-8": [500, 350],
  "sector-9": [390, 315],
  "sector-10": [270, 355],
  "sector-11": [165, 290],
};

export function App({ initialGame }: { initialGame?: GameState } = {}) {
  const loaded = initialGame ? null : readSave();
  const storageEnabled = !initialGame;
  const [view, setView] = useState<"campaign" | "field">("field");
  const [game, setGame] = useState<GameState>(
    () => initialGame ?? loaded?.game ?? createNewCampaign(SEED),
  );
  const [selectedSquad, setSelectedSquad] = useState("squad-1");
  const [selectedAction, setSelectedAction] =
    useState<Extract<OrderType, "move" | "attack">>("move");
  const [orders, setOrders] = useState<Order[]>([]);
  const [events, setEvents] = useState<RailEvent[]>(() => loaded?.events ?? []);
  const [reports, setReports] = useState<BattleReport[]>(
    () => loaded?.reports ?? [],
  );
  const [saveStatus, setSaveStatus] = useState(
    !initialGame
      ? loaded
        ? `RESUMED SAVED CAMPAIGN — ${SAVE_SUCCESS}`
        : readSaveNotice()
      : "",
  );
  const [error, setError] = useState("");
  const latestDebrief = events.find((event) => event.message.startsWith("TURN ") && event.message.includes(" DEBRIEF"));
  const persist = (nextGame: GameState, nextEvents = events, nextReports = reports) => {
    if (!storageEnabled) return null;
    const warning = writeSave({
      version: SAVE_VERSION,
      game: nextGame,
      events: nextEvents,
      reports: nextReports,
    });
    if (warning) {
      setSaveStatus(warning);
    } else {
      setSaveStatus(SAVE_SUCCESS);
    }
    return warning;
  };
  const income = calculateIncome(game);
  const plannedCost = queuedCost(orders, game);
  const remaining = {
    metal: game.resources.metal - plannedCost.metal,
    energy: game.resources.energy - plannedCost.energy,
  };
  const shortfall = {
    metal: Math.max(0, -remaining.metal),
    energy: Math.max(0, -remaining.energy),
  };
  const affordable = shortfall.metal === 0 && shortfall.energy === 0;
  const assaultForecasts = useMemo(
    () =>
      orders
        .filter((order): order is Order & { type: "attack" } => order.type === "attack" && Boolean(order.target))
        .map((order) => {
          const target = order.target!;
          const knownDefenders = game.enemySquads.filter(
            (enemy) => enemy.sector === target && game.revealedEnemySquads.includes(enemy.id),
          );
          const hiddenDefenders = game.enemySquads.some(
            (enemy) => enemy.sector === target && !game.revealedEnemySquads.includes(enemy.id),
          );
          return { target, knownDefenders, hiddenDefenders };
        }),
    [game, orders],
  );
  const squad =
    game.squads.find((s) => s.id === selectedSquad) ?? game.squads[0];
  const selectedId = squad?.id ?? "";
  const connectedIds = useMemo(
    () => new Set(connectedOwnedSectors(game).map((sector) => sector.id)),
    [game],
  );
  const recoveryCap = 10 + game.researchLevels.Logistics * 2;
  const recoveryStrengthAfter = squad
    ? Math.min(recoveryCap, squad.strength + 2 + game.researchLevels.Logistics)
    : 0;
  const recoveryFatigueAfter = squad
    ? Math.max(0, squad.fatigue - 2 - game.researchLevels.Logistics)
    : 0;
  const recoverySupplied = Boolean(
    squad &&
    connectedIds.has(squad.sector) &&
    game.sectors.find((sector) => sector.id === squad.sector)?.owner ===
      "player",
  );
  const recoveryHasBenefit = Boolean(
    squad &&
    (recoveryStrengthAfter > squad.strength ||
      recoveryFatigueAfter < squad.fatigue),
  );
  const attackRiskRationale = squad
    ? `ATTACK RISK · STR ${squad.strength}, FTG ${squad.fatigue}: HOLD is free and changes FTG to ${Math.max(0, squad.fatigue - 1)}; ${recoverySupplied ? `RECOVER costs ${recoveryMetalCost(game)} metal + 2 energy and changes STR to ${recoveryStrengthAfter}, FTG to ${recoveryFatigueAfter}` : "RECOVER is unavailable while unsupplied"}. ATTACK costs 2 metal + 3 energy and is available only against a legal target.`
    : "ATTACK RISK · select a squad to compare HOLD and RECOVER.";
  useEffect(() => {
    if (selectedSquad !== selectedId) setSelectedSquad(selectedId);
  }, [selectedId, selectedSquad]);
  const reachable = useMemo(
    () =>
      squad
        ? (game.sectors.find((s) => s.id === squad.sector)?.links ?? [])
        : [],
    [game, squad],
  );
  const legalTargets = useMemo(
    () =>
      squad
        ? reachable
            .map((id) => game.sectors.find((sector) => sector.id === id))
            .filter((sector): sector is GameState["sectors"][number] => {
              if (!sector || sector.id === squad.sector) return false;
              const occupied = game.enemySquads.some(
                (enemy) => enemy.sector === sector.id,
              );
              return selectedAction === "attack"
                ? sector.owner !== "player"
                : sector.owner !== "enemy" && !occupied;
            })
        : [],
    [game, reachable, selectedAction, squad],
  );
  const orderFor = (id: string) => orders.find((o) => o.squadId === id);
  const routeOrders = orders.filter(
    (order): order is Order & { target: SectorId } =>
      (order.type === "move" || order.type === "attack") && Boolean(order.target),
  );
  const unassignedSquads = game.squads.filter(
    (unit) => unit.strength > 0 && !orderFor(unit.id),
  );
  const canHoldUnassigned =
    game.terminal === "active" && unassignedSquads.length > 0;
  const nextUnassigned = (() => {
    if (!unassignedSquads.length) return undefined;
    const selectedIndex = game.squads.findIndex((unit) => unit.id === selectedId);
    const start = selectedIndex < 0 ? 0 : (selectedIndex + 1) % game.squads.length;
    for (let offset = 0; offset < game.squads.length; offset += 1) {
      const candidate = game.squads[(start + offset) % game.squads.length];
      if (candidate && unassignedSquads.some((unit) => unit.id === candidate.id)) return candidate;
    }
    return undefined;
  })();
  const canSelectNextUnassigned = game.terminal === "active" && Boolean(nextUnassigned);
  const selectedOrder = orderFor(selectedId);
  const selectNextUnassigned = () => {
    if (!canSelectNextUnassigned || !nextUnassigned) return;
    setSelectedSquad(nextUnassigned.id);
    setError("");
  };
  const holdUnassigned = () => {
    if (!canHoldUnassigned) return;
    setError("");
    setOrders((previous) => [
      ...previous,
      ...game.squads
        .filter((unit) => unit.strength > 0)
        .filter((unit) => !previous.some((order) => order.squadId === unit.id))
        .map((unit) => ({ squadId: unit.id, type: "hold" as const })),
    ]);
  };
  const sectorName = (id?: SectorId) =>
    id ? (game.sectors.find((sector) => sector.id === id)?.name ?? id) : "—";
  const enemyHq = game.sectors.find((sector) => sector.id === game.hq.enemy);
  const playerHq = game.sectors.find((sector) => sector.id === game.hq.player);
  const wardStrengthBySector = useMemo(() => {
    const counts = new Map<SectorId, { squads: number; strength: number }>();
    for (const unit of game.squads) {
      if (unit.strength <= 0) continue;
      const current = counts.get(unit.sector) ?? { squads: 0, strength: 0 };
      counts.set(unit.sector, { squads: current.squads + 1, strength: current.strength + unit.strength });
    }
    return counts;
  }, [game.squads]);
  const campaignObjectives = [
    ...game.objectives.map((objective) => ({
      key: objective.id,
      label: sectorName(objective.sector),
      status: objective.controlled ? "SECURED" : "REQUIRED",
    })),
    {
      key: "enemy-hq",
      label: enemyHq?.name ?? game.hq.enemy,
      status: enemyHq?.owner === "player" ? "CAPTURED" : "REQUIRED",
    },
  ];
  const requiredRelayLabels = campaignObjectives
    .filter((objective) => objective.key !== "enemy-hq" && objective.status === "REQUIRED")
    .map((objective) => objective.label);
  const setOrder = (type: OrderType, target?: SectorId) => {
    if (!selectedId || game.terminal !== "active") return;
    setError("");
    setOrders((previous) => [
      ...previous.filter((o) => o.squadId !== selectedId),
      { squadId: selectedId, type, target },
    ]);
  };
  const cancelOrder = (squadId: string) => {
    if (game.terminal !== "active") return;
    setOrders((previous) =>
      previous.filter((order) => order.squadId !== squadId),
    );
    setError("");
  };
  const execute = () => {
    if (!orders.length || !affordable || game.terminal !== "active") return;
    try {
      const before = game;
      const turn = resolveTurn(game, orders);
      const combat = resolveCombat(turn.nextState, turn.events);
      const enemy = resolveEnemyTurn(combat.nextState);
      const phaseReports = [...combat.reports, ...enemy.reports];
      const name = (id?: SectorId) => id ? before.sectors.find((sector) => sector.id === id)?.name ?? id : "unknown sector";
      const resourceDelta = (key: "metal" | "energy" | "intelligence") => enemy.nextState.resources[key] - before.resources[key];
      const playerLines = orders.map((order) => { const unit = before.squads.find((item) => item.id === order.squadId); const after = enemy.nextState.squads.find((item) => item.id === order.squadId); if (!unit) return null; const afterStrength = after?.strength ?? 0; const afterFatigue = after?.fatigue ?? unit.fatigue; const cost = order.type === "attack" ? "cost 2 metal + 3 energy" : order.type === "recover" ? `cost ${recoveryMetalCost(before)} metal + 2 energy` : "free"; const target = order.target ? enemy.nextState.sectors.find((sector) => sector.id === order.target) : enemy.nextState.sectors.find((sector) => sector.id === (after?.sector ?? unit.sector)); const control = target && before.sectors.find((sector) => sector.id === target.id)?.owner !== target.owner ? `; control ${target.name}: ${target.owner}` : ""; if (order.type === "hold" && afterStrength === unit.strength && afterFatigue === unit.fatigue && !control) return null; return squadLabel(unit) + " at " + name(unit.sector) + ": " + order.type.toUpperCase() + " (" + cost + ") — STR " + unit.strength + "→" + afterStrength + ", FTG " + unit.fatigue + "→" + afterFatigue + (afterStrength <= 0 ? " (DEAD)" : "") + control; }).filter(Boolean) as string[];
      const playerBattleLines = combat.reports.map((report) => name(report.target) + ": " + battleOutcomeLabel(report) + "; Ward −" + report.playerCasualties + ", hostile −" + report.enemyCasualties);
      const enemyBattleLines = enemy.reports.map((report) => name(report.target) + ": enemy assault — " + battleOutcomeLabel(report) + "; Ward −" + report.playerCasualties + ", hostile −" + report.enemyCasualties);
      const enemyLines = before.researchLevels.Signals > 0 && enemy.events.length ? enemy.events.map((event) => event.message.replace(/sector-\d+/g, (id) => name(id as SectorId))) : [];
      const relayLines = before.objectives.map((objective) => {
        const sector = before.sectors.find((candidate) => candidate.id === objective.sector);
        const after = sector && enemy.nextState.sectors.find((candidate) => candidate.id === sector.id);
        const playerPhase = sector && combat.nextState.sectors.find((candidate) => candidate.id === sector.id);
        return sector && after && (playerPhase?.owner !== sector.owner || after.owner !== playerPhase?.owner) ? `${sector.name}: ${sector.owner} → ${playerPhase?.owner ?? sector.owner} → ${after.owner}` : null;
      }).filter(Boolean) as string[];
      const beforeIncome = calculateIncome(before);
      const afterIncome = calculateIncome(enemy.nextState);
      const beforeConnected = connectedOwnedSectors(before);
      const afterConnected = connectedOwnedSectors(enemy.nextState);
      const connectedDelta = `${beforeConnected.length} sectors (${beforeConnected.map((sector) => sector.name).join(", ") || "none"}) → ${afterConnected.length} sectors (${afterConnected.map((sector) => sector.name).join(", ") || "none"})`;
      const incomeLine = `HQ-CONNECTED INCOME/SUPPLY: ${beforeIncome.metal}M ${beforeIncome.energy}E ${beforeIncome.intelligence}I / cap ${before.supplyCapacity} → ${afterIncome.metal}M ${afterIncome.energy}E ${afterIncome.intelligence}I / cap ${enemy.nextState.supplyCapacity}; connected ${connectedDelta}`;
      const unassignedFatigue = before.squads.map((unit) => {
        if (orders.some((order) => order.squadId === unit.id) || unit.strength <= 0) return null;
        const after = enemy.nextState.squads.find((candidate) => candidate.id === unit.id);
        return after && after.fatigue !== unit.fatigue ? `${squadLabel(unit)} at ${name(unit.sector)}: FTG ${unit.fatigue} → ${after.fatigue}` : null;
      }).filter(Boolean) as string[];
      const squadLosses = before.squads.map((unit) => {
        const after = enemy.nextState.squads.find((candidate) => candidate.id === unit.id);
        const afterStrength = after?.strength ?? 0;
        return afterStrength < unit.strength ? `${squadLabel(unit)}: STR ${unit.strength} → ${afterStrength}${afterStrength <= 0 ? " (DEAD)" : ""}` : null;
      }).filter(Boolean) as string[];
      const survivingSquads = enemy.nextState.squads.filter((unit) => unit.strength > 0);
      const nextChoices = enemy.nextState.terminal !== "active"
        ? "campaign complete — no further orders are available"
        : survivingSquads.length === 0
          ? "no surviving squads — restart the campaign"
          : "choose HOLD to reduce fatigue, RECOVER for strength, or ATTACK a legal target";
      const delta = `RESOURCES Δ metal ${resourceDelta("metal") >= 0 ? "+" : ""}${resourceDelta("metal")}, energy ${resourceDelta("energy") >= 0 ? "+" : ""}${resourceDelta("energy")}, intel ${resourceDelta("intelligence") >= 0 ? "+" : ""}${resourceDelta("intelligence")}`;
      const attackChoices = orders.map((order) => {
        if (order.type !== "attack") return null;
        const unit = before.squads.find((candidate) => candidate.id === order.squadId);
        if (!unit) return null;
        if (unit.strength <= 1 || unit.fatigue >= 3) {
          return `${squadLabel(unit)} at ${name(unit.sector)} attacked at STR ${unit.strength}, FTG ${unit.fatigue}: ATTACK risks losing this squad; HOLD reduces fatigue by 1, while RECOVER costs ${recoveryMetalCost(before)} metal + 2 energy for strength/fatigue recovery when available`;
        }
        return `${unit.class} at ${name(unit.sector)} attacked at STR ${unit.strength}, FTG ${unit.fatigue}: weigh ATTACK's 2 metal + 3 energy cost against HOLD fatigue reduction or RECOVER's strength recovery`;
      }).filter(Boolean) as string[];
      const debrief = [
        `TURN ${before.turn} DEBRIEF`,
        `WHAT CHANGED: ${playerLines.length ? playerLines.join("; ") : "no ordered squad change"}`,
        ...(relayLines.length ? [`RELAY CONTROL: ${relayLines.join("; ")}`] : []),
        ...(unassignedFatigue.length ? [`UNASSIGNED FATIGUE: ${unassignedFatigue.join("; ")}`] : []),
        ...(squadLosses.length ? [`SQUAD LOSSES: ${squadLosses.join("; ")}`] : []),
        delta,
        incomeLine,
        `PLAYER RESULT: ${playerBattleLines.length ? playerBattleLines.join("; ") : "no player assault observed"}`,
        ...(enemyBattleLines.length ? [`ENEMY RESULT: ${enemyBattleLines.join("; ")}`] : []),
        `ENEMY PHASE OBSERVED: ${enemyLines.length ? enemyLines.join("; ") : before.researchLevels.Signals > 0 ? "no movement observed" : "movement withheld — Signals 0"}`,
        `WHY: ${attackChoices.length ? attackChoices.join("; ") : "observed state/events above determine the result"}`,
        `NEXT: ${nextChoices}`,
      ].join("\n");
      setGame(enemy.nextState);
      const nextReports = phaseReports.length ? phaseReports : reports;
      const visibleEnemyEvents = before.researchLevels.Signals > 0 ? enemy.events.map((e) => e.message) : [];
      const nextEvents = (
        [
          ...[
            ...phaseReports.map(
              (report) =>
                `${report.target} ${report.winner} — ${report.playerCasualties} Ward casualties · ${report.enemyCasualties} hostile casualties ${report.casualties.length} casualty entries`,
            ),
            ...visibleEnemyEvents,
            ...turn.events.map((e) => e.message),
            debrief
          ].map((message) => ({
            turn: game.turn,
            message: message.replace(/sector-\d+/g, (id) => name(id as SectorId)),
          })),
          ...events,
        ].slice(0, 20)
      ) as RailEvent[];
      if (phaseReports.length) setReports(phaseReports);
      setEvents(nextEvents);
      const warning = persist(enemy.nextState, nextEvents, nextReports);
      setOrders([]);
      if (!warning) setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Orders rejected");
    }
  };
  const research = (branch: ResearchBranch) => {
    try {
      const nextGame = advanceResearch(game, branch);
      setGame(nextGame);
      const warning = persist(nextGame);
      if (!warning) setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Research rejected");
    }
  };
  const reset = () => {
    const nextGame = createNewCampaign(game.seed);
    setGame(nextGame);
    setSelectedSquad("squad-1");
    setOrders([]);
    setEvents([]);
    setReports([]);
    setError("");
    const warning = persist(nextGame, [], []);
  };
  if (!game.squads.length)
    return (
      <main className="command-shell">
        <section className="notes card">
          <p className="eyebrow">RIMEWARD // NORTHERN FRONTIER</p>
          <h1>THE WHITE LINE</h1>
          <h2>NO SURVIVORS</h2>
          <p>The Ward has no active squads. The campaign is over.</p>
          {saveStatus && (
            <p className="save-status" role="status">
              {saveStatus}
            </p>
          )}
          <button className="primary" onClick={reset}>
            NEW CAMPAIGN · SEED {game.seed}
          </button>
        </section>
      </main>
    );
  return (
    <main className="command-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">RIMEWARD // NORTHERN FRONTIER</p>
          <h1>THE WHITE LINE</h1>
          <p className="seed-readout">SEED {game.seed}</p>
        </div>
        <div className="turn-readout">
          <span>TURN</span>
          <strong>{game.turn.toString().padStart(2, "0")}</strong>
          <span>OPERATION THAWLINE</span>
          <button onClick={reset}>NEW CAMPAIGN</button>
        </div>
      </header>
      <nav aria-label="Main navigation">
        <button
          className={view === "field" ? "active" : ""}
          onClick={() => setView("field")}
        >
          TACTICAL FIELD
        </button>
        <button
          className={view === "campaign" ? "active" : ""}
          onClick={() => setView("campaign")}
        >
          FIELD NOTES
        </button>
      </nav>
      {view === "campaign" ? (
        <section className="notes card">
          <p className="eyebrow">FIELD NOTES // COMMAND REFERENCE</p>
          <h2>
            {game.terminal === "victory"
              ? "WIN: SECURE ALL THREE RELAYS"
              : game.terminal === "defeat"
                ? "LOSS: " + game.terminalReason
                : "WIN: SECURE ALL THREE RELAYS"}
          </h2>
          <p>
            Capture all three relays, then assault the enemy HQ at sector 6 to
            win. Lose if HQ falls, every Ward squad is gone, or turn 18 ends.
          </p>
          <h3>PHASE ORDER</h3>
          <p>
            Orders → combat → the full visible enemy phase → income. Attacks
            cost 2 metal + 3 energy; recover costs 6 metal + 2 energy, restores
            2 strength, and reduces fatigue. Grouped attacks gain a bounded
            coordination bonus, but defended assaults cost tempo and casualties.
            Hold reduces fatigue by 1; unordered squads gain fatigue. Defended
            attacks show deterministic expected losses in the battle report;
            undefended attacks cause no combat damage.
          </p>
          <h3>COUNTERS & TERRAIN</h3>
          <p>
            Sentinel counters Raider, Raider counters Recon, Recon counters
            Artillery, and Artillery counters Sentinel. Ice ×0.9, tundra ×1,
            crater ×1.05, ridge ×1.15. Fatigue reduces attacking power.
          </p>
          <h3>RESEARCH & SUPPLY</h3>
          <p>
            Logistics rules: base strength/supply cap is 10; tier 1 raises both
            to 12; tier 2 raises both to 14. A squad counts as supplied only
            through owned sectors connected to HQ. Capacity counts owned
            HQ-connected sectors eligible for supply; it does not cap squad
            count. Logistics still raises the strength cap 10→12→14 and improves
            recovery by +1 strength and -1 fatigue per tier. Warfare improves
            counters; Signals reveals enemy positions and forecast routes.
            Income comes only from Ward sectors connected to HQ.
          </p>
          <button className="primary" onClick={() => setView("field")}>
            Return to tactical field
          </button>
        </section>
      ) : (
        <>
          {saveStatus && (
            <p className="save-status" role="status">
              {saveStatus}
            </p>
          )}
          {game.terminal !== "active" && (
            <section className="terminal card">
              <p className="eyebrow">CAMPAIGN TERMINAL</p>
              <h2>
                {game.terminal === "victory"
                  ? "VICTORY"
                  : game.turn > 18
                    ? "TURN 18 — DEFEAT"
                    : "DEFEAT"}
              </h2>
              <p>{game.terminalReason}</p>
              <button className="primary" onClick={reset}>
                RESTART · SEED {game.seed}
              </button>
              <button
                onClick={() => {
                  const seed = (game.seed * 1664525 + 1013904223) >>> 0;
                  const nextGame = createNewCampaign(seed);
                  setGame(nextGame);
                  setOrders([]);
                  setEvents([]);
                  setReports([]);
                  setError("");
                  persist(nextGame, [], []);
                }}
              >
                NEW SEED
              </button>
            </section>
          )}
          <section className="turn-guide" aria-label="Turn guide">
            <p className="eyebrow">TURN GUIDE · TURN {game.turn}</p>
            <h3>GOAL</h3>
            <p>
              {game.terminal === "active"
                ? `Hold all relays AND enemy HQ; defend ${playerHq?.name ?? game.hq.player}. Remaining relays: ${requiredRelayLabels.join(", ") || "none"}. HQ: ${enemyHq?.name ?? game.hq.enemy} ${enemyHq?.owner === "player" ? "CAPTURED" : "REQUIRED"}. Objectives may not be reachable this turn.`
                : game.terminal === "victory"
                  ? "The frontier is secure."
                  : "The campaign has ended."}
            </p>
            {game.terminal === "active" ? (
              <ol>
                <li>
                  <strong>SELECT SQUAD</strong> — {squad.class.toUpperCase()} {squad.id.slice(-1)} at {sectorName(squad.sector)} (STR {squad.strength}, FTG {squad.fatigue}).
                </li>
                <li>
                  <strong>CHOOSE {selectedAction.toUpperCase()}</strong> — {selectedAction === "attack"
                    ? "choose a legal target below to queue ATTACK."
                    : "choose a highlighted target below to queue MOVE."}
                </li>
                <li>
                  <strong>{legalTargets.length ? "HIGHLIGHTED LEGAL DESTINATION" : "NO LEGAL TARGETS"}</strong> — {legalTargets.length
                    ? legalTargets.map((target) => target.name).join(", ")
                    : selectedAction === "attack"
                      ? recoverySupplied
                        ? "no enemy target is reachable; use HOLD or select another squad."
                        : "no enemy target is reachable; use HOLD or change squad (RECOVER is unavailable outside supplied territory)."
                      : recoverySupplied
                        ? "no unoccupied friendly destination is reachable; use HOLD or RECOVER, or select ATTACK when an enemy-held destination is legal."
                        : "no unoccupied friendly destination is reachable; use HOLD or change squad (RECOVER is unavailable outside supplied territory)."}
                </li>
                <li>
                  <strong>{orders.length ? `QUEUED (${orders.length}) — NOT EXECUTED` : "NOT QUEUED"}</strong> — {orders.length ? `${selectedOrder ? `${selectedOrder.type.toUpperCase()} is queued for the selected squad. ` : ""}${unassignedSquads.length} unassigned${unassignedSquads.length === 1 ? " squad" : " squads"}; ${unassignedSquads.length ? "choose another or HOLD UNASSIGNED to avoid fatigue. " : ""}Player orders resolve first, then the enemy phase. EXECUTE TURN resolves assigned orders without requiring all squads.` : "Queue orders for your squads."}
                </li>
              </ol>
            ) : (
              <p className="muted">Terminal state: {game.terminal.toUpperCase()}. The campaign is over; use RESTART or NEW SEED above to replay or begin a new campaign. No further planning is available.</p>
            )}
            {game.terminal === "active" && (
              <p className="muted">Selecting MOVE/ATTACK does not queue; choose highlighted target.</p>
            )}
            {game.terminal === "active" && (
              <p className="muted">STR = strength. FTG = fatigue. HOLD is free and lowers FTG by 1; unassigned squads gain 1 fatigue. Supplied RECOVER costs the shown metal + 2 energy, restores strength, and lowers fatigue; it is unavailable when unsupplied.</p>
            )}
          </section>
          <section className="resource-strip">
            <span>
              <b>METAL</b> {game.resources.metal}
            </span>
            <span>
              <b>ENERGY</b> {game.resources.energy}
            </span>
            <span>
              <b>INTEL</b> {game.resources.intelligence}
            </span>
            <span>
              <b>SUPPLY</b> {connectedOwnedSectors(game).length}/
              {game.supplyCapacity}
            </span>
            <span className="objective-count">
              <b>RELAYS</b> {game.objectives.filter((o) => o.controlled).length}
              /3
            </span>
          </section>
          <section
            className="campaign-objectives card"
            aria-label="Campaign objectives"
          >
            <div className="panel-heading">
              <h2>CAMPAIGN OBJECTIVES</h2>
              {game.terminal === "active" ? (
                <span className="muted">
                  {Math.max(0, 19 - game.turn)}{" "}
                  {Math.max(0, 19 - game.turn) === 1
                    ? "PLAYABLE TURN"
                    : "PLAYABLE TURNS"}{" "}
                  REMAINING INCLUDING THIS TURN
                </span>
              ) : (
                <span className="muted">CAMPAIGN COMPLETE</span>
              )}
            </div>
            <p className="muted">
              Secure all relays and capture enemy HQ. Defend{" "}
              {playerHq?.name ?? game.hq.player}.
            </p>
            <div className="objective-list">
              {campaignObjectives.map((objective) => (
                <div className="objective" key={objective.key}>
                  <b>
                    {objective.key === "enemy-hq" ? "Enemy HQ" : "Relay"} —{" "}
                    {objective.label}
                  </b>{" "}
                  · {objective.status}
                </div>
              ))}
            </div>
          </section>
          <section className="card debrief-panel" aria-label="Last turn debrief">
            <div className="panel-heading">
              <h2>WHAT CHANGED / WHY</h2>
              <span className="muted">LAST TURN</span>
            </div>
            {latestDebrief ? (() => { const lines = latestDebrief.message.split("\n"); const priority = ["PLAYER RESULT:", "ENEMY RESULT:", "RELAY CONTROL:", "SQUAD LOSSES:", "HQ-CONNECTED INCOME/SUPPLY:", "WHAT CHANGED:", "WHY:"]; const next = lines.find((line) => line.startsWith("NEXT:")); const summary = [...priority.map((prefix) => lines.find((line) => line.startsWith(prefix))).filter(Boolean).slice(0, 4), next].filter(Boolean) as string[]; const details = lines.filter((line) => !summary.includes(line)); const row = (line: string, index: number) => { const key = line.split(":", 1)[0].toLowerCase().replaceAll(" ", "-"); return <p className={`debrief-row debrief-${key}`} key={`${key}-${index}`}>{line}</p>; }; return <><div className="debrief-summary">{summary.map(row)}</div>{details.length ? <details><summary>SHOW FULL TURN DETAILS</summary>{details.map(row)}</details> : null}</>; })() : <p className="muted">Execute a turn to see the observed state changes, outcomes, and next choices.</p>}
          </section>
          <div className="battle-layout">
            <section className="map-panel card">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">NORTHERN FRONTIER</p>
                  <h2>TACTICAL GRID</h2>
                </div>
                <span className="status-dot">LIVE FEED</span>
              </div>
              <svg
                className="map"
                viewBox="0 0 780 440"
                role="img"
                aria-label="Tactical sector map"
              >
                <defs>
                  {(["move", "attack"] as const).map((type) => (
                    <marker id={`planned-arrow-${type}`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" key={type}>
                      <path d="M0,0 L7,3.5 L0,7 z" className={`planned-arrow planned-arrow-${type}`} fill="#f0dda1" stroke="#071114" strokeWidth="0.8" />
                    </marker>
                  ))}
                </defs>
                {game.sectors.flatMap((s) =>
                  s.links
                    .filter((l) => s.id < l)
                    .map((l) => (
                      <line
                        key={s.id + l}
                        x1={pos[s.id][0]}
                        y1={pos[s.id][1]}
                        x2={pos[l][0]}
                        y2={pos[l][1]}
                        className="link"
                      />
                    )),
                )}
                <g className="planned-orders" aria-label="Planned orders">
                  {routeOrders.map((order) => {
                      const unit = game.squads.find((s) => s.id === order.squadId);
                      const target = order.target;
                      if (!unit || !target) return null;
                      const origin = pos[unit.sector];
                      const destination = pos[target];
                      const sharedOrders = orders.filter(
                        (candidate) =>
                          (candidate.type === "move" || candidate.type === "attack") &&
                          candidate.target === target,
                      );
                      const sharedIndex = sharedOrders.findIndex(
                        (candidate) => candidate.squadId === order.squadId,
                      );
                      const offset = sharedOrders.length > 1 ? (sharedIndex - (sharedOrders.length - 1) / 2) * 22 : 0;
                      const dx = destination[0] - origin[0];
                      const dy = destination[1] - origin[1];
                      const length = Math.hypot(dx, dy) || 1;
                      const nx = -dy / length;
                      const ny = dx / length;
                      const startX = origin[0] + nx * offset;
                      const startY = origin[1] + ny * offset;
                      const markerX = destination[0] + (dx / length) * 40 + nx * offset;
                      const markerY = destination[1] + (dy / length) * 40 + ny * offset;
                      const endX = markerX;
                      const endY = markerY;
                      const orderLabel = `PLAN · ${order.type.toUpperCase()} · ${unit.class.toUpperCase()}`;
                      const squadNumber = unit.id.match(/(\d+)$/)?.[1] ?? unit.id;
                      const conciseLabel = `${order.type === "move" ? "M" : "A"}${squadNumber}`;
                      return (
                        <g
                          className="planned-order"
                          data-order-id={order.squadId}
                          data-target={target}
                          aria-label={`${orderLabel} ${conciseLabel} to ${sectorName(target)}`}
                          key={`${order.squadId}-${order.type}-${target}`}
                        >
                          <title>{`${orderLabel} ${conciseLabel} → ${sectorName(target)}`}</title>
                          <line
                            className={`planned-route planned-${order.type}`}
                            x1={startX}
                            y1={startY}
                            x2={endX}
                            y2={endY}
                            markerEnd={`url(#planned-arrow-${order.type})`}
                          />
                          {(
                            <g
                              className={`planned-marker planned-marker-${squadNumber}`}
                              role="img"
                              aria-label={`${orderLabel} ${conciseLabel} to ${sectorName(target)}`}
                            >
                              <circle cx={endX} cy={endY} r="9" />
                              <text x={endX} y={endY + 3} textAnchor="middle">{conciseLabel}</text>
                            </g>
                          )}
                        </g>
                      );
                    })}
                </g>
                {game.sectors.map((s) => {
                  const [x, y] = pos[s.id];
                  const wardPresence = wardStrengthBySector.get(s.id);
                  const active = s.id === squad.sector;
                  const occupied = game.enemySquads.some(
                    (enemy) => enemy.sector === s.id,
                  );
                  const scouted = game.researchLevels.Signals > 0 && occupied;
                  const target =
                    game.terminal === "active" &&
                    reachable.includes(s.id) &&
                    s.id !== squad.sector &&
                    (selectedAction === "attack"
                      ? s.owner !== "player"
                      : s.owner !== "enemy" && !occupied);
                  const chooseTarget = () => {
                    if (game.terminal !== "active") return;
                    if (target) setOrder(selectedAction, s.id);
                    else if (
                      reachable.includes(s.id) &&
                      selectedAction === "move" &&
                      occupied
                    )
                      setError(
                        "Cannot move through an enemy squad; select ATTACK",
                      );
                  };
                  return (
                    <g
                      key={s.id}
                      className={`sector ${s.owner} ${active ? "selected" : ""} ${target ? "reachable" : ""}`}
                      role="button"
                      aria-disabled={game.terminal !== "active"}
                      tabIndex={target ? 0 : -1}
                      focusable="true"
                      aria-label={`${s.name}, ${s.owner} sector${wardPresence ? `, ${wardPresence.squads} living Ward squad${wardPresence.squads === 1 ? "" : "s"}` : ""}${scouted ? ", scouted enemy squad present" : ""}${target ? `, ${selectedAction} target` : ""}`}
                      onClick={chooseTarget}
                      onKeyDown={(event) => {
                        if (
                          target &&
                          (event.key === "Enter" || event.key === " ")
                        ) {
                          event.preventDefault();
                          chooseTarget();
                        }
                      }}
                    >
                      <circle cx={x} cy={y} r="28" />
                      <text x={x} y={y + 3} textAnchor="middle">
                        {s.name.slice(0, 3).toUpperCase()}
                      </text>
                      <text
                        x={x}
                        y={y + 48}
                        textAnchor="middle"
                        className="sector-label"
                      >
                        {s.name}
                      </text>
                      {wardPresence && (
                        <g className="ward-strength-badge" aria-label={`${wardPresence.squads} living Ward squad${wardPresence.squads === 1 ? "" : "s"}`}>
                          <rect x={x - 16} y={y + 55} width="32" height="22" rx="4" />
                          <text x={x} y={y + 72} textAnchor="middle">{wardPresence.squads}</text>
                        </g>
                      )}
                      {game.objectives.some((o) => o.sector === s.id) && (
                        <rect
                          x={x + 18}
                          y={y - 34}
                          width="12"
                          height="12"
                          className="relay"
                        />
                      )}
                      {s.id === game.hq.player && (
                        <text
                          x={x}
                          y={y - 39}
                          textAnchor="middle"
                          className="hq"
                        >
                          HQ
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
              <div className="legend" aria-label="Map legend">
                <span>
                  <i className="legend-dot player" />
                  WARD
                </span>
                <span>
                  <i className="legend-dot enemy" />
                  HOSTILE
                </span>
                <span>
                  <i className="legend-dot neutral" />
                  UNHELD
                </span>
                <span>◈ RELAY</span>
                <span className="ward-legend" aria-label="Ward squad badge legend">Ward squads</span>
                <span className="plan-key plan-legend" aria-label="Planned orders legend">
                  PLAN = queued order; M/MOVE and A/ATTACK; endpoint markers use the same squad token as each queued-order detail
                </span>
                <span className="plan-key" aria-label="Planned move key">
                  <i className="plan-line move" />
                  PLAN · MOVE
                </span>
                <span className="plan-key">
                  <i className="plan-line attack" />
                  PLAN · ATTACK
                </span>
                {routeOrders.map((order) => (
                  <span
                    className="plan-key plan-entry"
                    key={order.squadId + "-" + order.type + "-" + order.target}
                    aria-label={"Queued order " + order.squadId + " " + order.type + " " + sectorName(order.target)}
                  >
                    <i className={"plan-line " + order.type} />
                    {order.type === "move" ? "M" : "A"}{order.squadId.match(/(\d+)$/)?.[1] ?? order.squadId} · {order.squadId} · {order.type.toUpperCase()} →{" "}
                    {sectorName(order.target)}
                  </span>
                ))}
              </div>
            </section>
            <aside className="side-panel">
              {reports.length > 0 && (
                <section className="reports card">
                  <div className="panel-heading">
                    <h2>BATTLE REPORT</h2>
                    <span className="muted">RESOLVED</span>
                  </div>
                  {reports.map((report, index) => (
                    <article key={`${report.target}-${report.winner}-${index}`}>
                      <h3>
                        {game.sectors.find((s) => s.id === report.target)?.name}{" "}
                        · {report.winner.toUpperCase()}
                      </h3>
                      <p>
                        ATTACKER{" "}
                        {report.attackers
                          .map(
                            (unit) =>
                              `${unit.class} ${unit.units}/${unit.strength}`,
                          )
                          .join(", ")}
                      </p>
                      <p>
                        DEFENDER{" "}
                        {report.defenders
                          .map(
                            (unit) =>
                              `${unit.class} ${unit.units}/${unit.strength}`,
                          )
                          .join(", ") || "NONE"}
                      </p>
                      <p>
                        Terrain {report.terrain} ×{report.terrainMultiplier} ·
                        fatigue −{report.fatiguePenalty} · variance{" "}
                        {report.variance}
                      </p>
                      <p>
                        {report.classAdvantages
                          .concat(report.defenderCounters)
                          .join(" · ") || "No class counter"}{" "}
                        · {report.casualties.length} casualty entries
                      </p>
                      <p>
                        {report.retreat.length
                          ? `Retreat: ${report.retreat.map((item) => item.to).join(", ")}`
                          : "No retreat"}{" "}
                        · {report.captured ? "Captured" : "Not captured"}
                      </p>
                    </article>
                  ))}
                </section>
              )}
              <section className="card squad-panel">
                <div className="panel-heading">
                  <h2>WARD SQUADS</h2>
                  <span className="muted">{game.squads.length} ACTIVE</span>
                </div>
                {game.squads.map((s) => (
                  <button
                    key={s.id}
                    className={`squad-card ${s.id === selectedSquad ? "chosen" : ""}`}
                    onClick={() => setSelectedSquad(s.id)}
                  >
                    <span className="class-mark">{s.class.slice(0, 1)}</span>
                    <span>
                      <strong>
                        {s.class.toUpperCase()} //{" "}
                        {s.id.slice(-1).padStart(2, "0")}
                      </strong>
                      <small>
                        {game.sectors.find((x) => x.id === s.sector)?.name}
                      </small>
                    </span>
                    <span className="squad-stats">
                      STR {s.strength}
                      <br />
                      FTG {s.fatigue}
                    </span>
                    {orderFor(s.id) && <em>{orderFor(s.id)!.type}</em>}
                  </button>
                ))}
              </section>
              <section className="card orders">
                <p className="eyebrow">
                  SELECTED: {squad.class.toUpperCase()} {squad.id.slice(-1)}
                </p>
                <h2>ORDERS</h2>
                <p className="selection-note">
                  {game.sectors.find((s) => s.id === squad.sector)?.name} ·
                  choose an action
                </p>
                <div className="order-buttons">
                  {(["hold", "recover", "move", "attack"] as OrderType[]).map(
                    (type) => (
                      <button
                        disabled={
                          game.terminal !== "active" ||
                          (type === "recover" && !recoverySupplied)
                        }
                        key={type}
                        className={
                          orderFor(selectedSquad)?.type === type ||
                          (selectedAction === type &&
                            (type === "move" || type === "attack"))
                            ? "order-active"
                            : ""
                        }
                        aria-pressed={
                          type === "move" || type === "attack"
                            ? selectedAction === type
                            : undefined
                        }
                        onClick={() =>
                          type === "move" || type === "attack"
                            ? (setSelectedAction(type), setError(""))
                            : setOrder(type)
                        }
                      >
                        {type.toUpperCase()}
                      </button>
                    ),
                  )}
                </div>
                <section
                  className="recovery-preview"
                  aria-label="Recovery preview"
                >
                  <h3>RECOVER</h3>
                  <p>
                    {recoverySupplied
                      ? recoveryHasBenefit
                        ? `BEFORE ENEMY PHASE · costs ${recoveryMetalCost(game)} metal + 2 energy · STR ${squad.strength} → ${recoveryStrengthAfter} · FTG ${squad.fatigue} → ${recoveryFatigueAfter}`
                        : `BEFORE ENEMY PHASE · costs ${recoveryMetalCost(game)} metal + 2 energy · No benefit: recovery would not change this squad's strength or fatigue.`
                      : "Unavailable outside supplied player territory; recovery promises no gains."}
                  </p>
                </section>
                <section className="recovery-preview" aria-label="Hold preview">
                  <h3>HOLD</h3>
                  <p>
                    BEFORE ENEMY PHASE · free · STR {squad.strength} →{" "}
                    {squad.strength} · FTG {squad.fatigue} →{" "}
                    {Math.max(0, squad.fatigue - 1)}
                  </p>
                </section>
                <section className="recovery-preview" aria-label="Attack preview"><h3>ATTACK RISK</h3><p>{attackRiskRationale}{assaultForecasts.length > 0 ? " " + assaultForecasts.map(({ target }) => `${sectorName(target)}: outcome and losses are uncertain.`).join(" · ") : " Choose a legal target to preview the assault forecast."}</p></section>
                <section className="research">
                  <h3>RESEARCH</h3>
                  {(
                    ["Logistics", "Warfare", "Signals"] as ResearchBranch[]
                  ).map((branch) =>
                    (() => {
                      const level = game.researchLevels[branch];
                      const complete = level >= 2;
                      const cost = complete
                        ? null
                        : researchCost(branch, level);
                      const price = cost
                        ? Object.entries(cost)
                            .filter(([, amount]) => amount > 0)
                            .map(
                              ([resource, amount]) => `${amount} ${resource}`,
                            )
                            .join(" + ")
                        : "";
                      return (
                        <button
                          disabled={game.terminal !== "active" || complete}
                          key={branch}
                          onClick={() => research(branch)}
                        >
                          {branch} <b>{level}/2</b>
                          <small>
                            {complete
                              ? "COMPLETE"
                              : `NEXT: LVL ${level + 1} · ${researchEffect(branch, level + 1)} · COST: ${price}`}
                          </small>
                        </button>
                      );
                    })(),
                  )}
                </section>
                {assaultForecasts.length > 0 && (
                  <section className="expected-losses" aria-label="Expected assault losses">
                    <h3>ASSAULT FORECAST</h3>
                    {assaultForecasts.map(({ target, knownDefenders, hiddenDefenders }, index) => (
                      <p key={`${target}-${index}`}>
                        {sectorName(target)}: {hiddenDefenders
                          ? "Defenders unknown; outcome and losses are uncertain."
                          : knownDefenders.length
                            ? `Known hostile presence (${knownDefenders.map((enemy) => enemy.class.toUpperCase()).join(", ")}); outcome and losses are uncertain.`
                            : "No known defenders; hidden defenders may be present. Outcome and losses are uncertain."}
                      </p>
                    ))}
                  </section>
                )}
                {error && (
                  <p className="error" role="alert">
                    ! {error}
                  </p>
                )}
                <section className="queued-orders" aria-label="Queued orders">
                  <h3>QUEUED ORDERS</h3>
                  <p className="unassigned-count">
                    UNASSIGNED LIVING SQUADS: {unassignedSquads.length}
                  </p>
                  <button
                    disabled={!canHoldUnassigned}
                    onClick={holdUnassigned}
                  >
                    HOLD UNASSIGNED
                  </button>
                  <button
                    disabled={!canSelectNextUnassigned}
                    onClick={selectNextUnassigned}
                  >
                    NEXT UNASSIGNED
                  </button>
                  {game.terminal !== "active" ? (
                    <p className="muted">
                      Campaign complete. No orders can be queued.
                    </p>
                  ) : (
                    <>
                      {orders.length ? (
                        <ul>
                          {orders.map((order) => {
                            const unit = game.squads.find(
                              (s) => s.id === order.squadId,
                            )!;
                            const label = `${unit.class.toUpperCase()} ${unit.id} · ${order.type.toUpperCase()}${
                              order.type === "move" || order.type === "attack"
                                ? ` → ${sectorName(order.target)}`
                                : ""
                            }`;
                            return (
                              <li className="queued-order" key={order.squadId}>
                                {label}{" "}
                                <button
                                  aria-label={`Cancel ${label}`}
                                  onClick={() => cancelOrder(order.squadId)}
                                >
                                  CANCEL
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="muted">
                          No orders queued. Choose a squad and an action to plan
                          the turn.
                        </p>
                      )}
                      <p className="muted">
                        Cancel leaves a squad unassigned; it does not HOLD.
                        Unassigned squads gain fatigue when the turn executes.
                      </p>
                    </>
                  )}
                </section>
                <p className="budget" aria-label="queued resource budget">
                  QUEUED {plannedCost.metal}M + {plannedCost.energy}E ·
                  REMAINING {remaining.metal}M + {remaining.energy}E BEFORE
                  INCOME
                  {!affordable && (
                    <>
                      {" "}
                      · SHORT {shortfall.metal ? `${shortfall.metal}M` : ""}
                      {shortfall.metal && shortfall.energy ? " + " : ""}
                      {shortfall.energy ? `${shortfall.energy}E` : ""}
                    </>
                  )}
                </p>
                <button
                  className="execute"
                  disabled={
                    !orders.length || !affordable || game.terminal !== "active"
                  }
                  onClick={execute}
                >
                  EXECUTE TURN <span>→</span>
                </button>
              </section>
              <section className="card event-rail">
                <div className="panel-heading">
                  <h2>EVENT RAIL</h2>
                  <span className="muted">RECENT</span>
                </div>
                {events.length ? (
                  events.map((event, i) => (
                    <p key={i}>
                      <span>{event.turn.toString().padStart(2, "0")}</span>
                      {event.message}
                    </p>
                  ))
                ) : (
                  <p className="muted">Awaiting first orders...</p>
                )}
              </section>
            </aside>
          </div>
          <section className="income card">
            <b>HQ-CONNECTED INCOME</b>
            {game.sectors
              .filter((s) => s.owner === "player")
              .map((s) => (
                <span key={s.id}>
                  {s.name}:{" "}
                  {(() => {
                    const connected = connectedOwnedSectors(game).some(
                      (x) => x.id === s.id,
                    );
                    const interrupted = game.enemySquads.some(
                      (enemy) => enemy.strength > 0 && enemy.sector === s.id,
                    );
                    const site =
                      s.id === game.hq.player
                        ? "HQ"
                        : s.id === "sector-2" || s.id === "sector-10"
                          ? "DEPOT"
                          : s.id === "sector-3" || s.id === "sector-9"
                            ? "RELAY"
                            : "LAND";
                    if (!connected) return `${site} DISCONNECTED · +0M +0E +0I`;
                    if (interrupted) return `${site} INTERRUPTED · +0M +0E +0I`;
                    const metal = site === "HQ" ? 2 : site === "LAND" ? 0 : 1;
                    const energy = site === "HQ" ? 2 : site === "LAND" ? 0 : 1;
                    const intel = site === "HQ" ? 1 : 0;
                    return `${site} CONNECTED · +${metal}M +${energy}E +${intel}I`;
                  })()}
                </span>
              ))}
            <strong>
              TOTAL +{income.metal}M +{income.energy}E +{income.intelligence}I /
              TURN
            </strong>
          </section>
          <section className="intel card" aria-label="Signals intelligence">
            <b>SIGNALS INTELLIGENCE</b>{" "}
            {game.researchLevels.Signals === 0 ? (
              "POSITIONS OBSCURED"
            ) : (
              <>
                {game.enemySquads
                  .filter((enemy) =>
                    game.revealedEnemySquads.includes(enemy.id),
                  )
                  .map((enemy) => (
                    <span key={enemy.id}>
                      {" "}
                      {enemy.class.toUpperCase()} {enemy.id} @{" "}
                      {
                        game.sectors.find(
                          (sector) => sector.id === enemy.sector,
                        )?.name
                      }
                    </span>
                  ))}{" "}
                · TIER {game.researchLevels.Signals}
              </>
            )}
            {game.scoutedEnemyRoutes.length > 0 && (
              <small>
                {" "}
                · ROUTE INTENTS:{" "}
                {game.scoutedEnemyRoutes
                  .map(
                    (route, index) =>
                      `${game.enemySquads[index]?.id ?? "enemy"} ${route}`,
                  )
                  .join(" · ")}
              </small>
            )}
          </section>
          <section
            className="research-effects card"
            aria-label="Research effects"
          >
            {(["Logistics", "Warfare", "Signals"] as ResearchBranch[]).map(
              (branch) => (
                <span key={branch}>
                  <b>
                    {branch} TIER {game.researchLevels[branch]}
                  </b>{" "}
                  ·{" "}
                  {game.researchLevels[branch]
                    ? researchEffect(branch, game.researchLevels[branch])
                    : `NEXT: ${researchEffect(branch, 0)}`}
                </span>
              ),
            )}
          </section>
        </>
      )}
    </main>
  );
}
