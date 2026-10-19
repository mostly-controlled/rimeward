import { useEffect, useMemo, useState } from "react";
import {
  advanceResearch,
  calculateIncome,
  connectedOwnedSectors,
  createNewCampaign,
  researchCost,
  researchCurrency,
  resolveCombat,
  resolveEnemyTurn,
  resolveTurn,
  type BattleReport,
  type GameState,
  type Order,
  type OrderType,
  type ResearchBranch,
  type SectorId,
} from "../game/simulation";
import { readSave, readSaveNotice, SAVE_VERSION, writeSave } from "../game/persistence";

type RailEvent = { turn: number; message: string };

const queuedCost = (orders: Order[]) =>
  orders.reduce(
    (total, order) => ({
      metal: total.metal + (order.type === "attack" ? 2 : order.type === "recover" ? 6 : 0),
      energy: total.energy + (order.type === "attack" ? 3 : order.type === "recover" ? 2 : 0),
    }),
    { metal: 0, energy: 0 },
  );

const SEED = 42024;
const researchEffect = (branch: ResearchBranch, level: number) =>
  ({
    Logistics: [
      "Supply capacity +2 · recovery +1",
      "Supply capacity +4 · recovery +2",
    ],
    Warfare: [
      "Counter matchups +5% power · fortification +5%",
      "Counter matchups +10% power · fortification +10%",
    ],
    Signals: [
      "Reveal hostile identities and sectors",
      "Reveal identities, sectors, and legal route intents",
    ],
  })[branch][Math.max(0, Math.min(level - 1, 1))];
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
  const [reports, setReports] = useState<BattleReport[]>(() => loaded?.reports ?? []);
  const [storageWarning, setStorageWarning] = useState(false);
  const [error, setError] = useState(!initialGame ? (loaded ? "RESUMED SAVED CAMPAIGN — queued orders were not saved." : readSaveNotice()) : "");
  const persist = (nextGame: GameState, nextEvents = events, nextReports = reports) => {
    if (!storageEnabled) return null;
    const warning = writeSave({ version: SAVE_VERSION, game: nextGame, events: nextEvents, reports: nextReports });
    if (warning) {
      setStorageWarning(true);
      setError(warning);
    }
    return warning;
  };
  const income = calculateIncome(game);
  const plannedCost = queuedCost(orders);
  const remaining = {
    metal: game.resources.metal - plannedCost.metal,
    energy: game.resources.energy - plannedCost.energy,
  };
  const shortfall = {
    metal: Math.max(0, -remaining.metal),
    energy: Math.max(0, -remaining.energy),
  };
  const affordable = shortfall.metal === 0 && shortfall.energy === 0;
  const expectedReports = useMemo(() => {
    if (!orders.some((order) => order.type === "attack")) return [];
    try {
      const planned = resolveTurn(game, orders);
      return resolveCombat(planned.nextState, planned.events).reports;
    } catch {
      return [];
    }
  }, [game, orders]);
  const squad =
    game.squads.find((s) => s.id === selectedSquad) ?? game.squads[0];
  const selectedId = squad?.id ?? "";
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
  const orderFor = (id: string) => orders.find((o) => o.squadId === id);
  const sectorName = (id?: SectorId) => id ? game.sectors.find((sector) => sector.id === id)?.name ?? id : "—";
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
    setOrders((previous) => previous.filter((order) => order.squadId !== squadId));
    setError("");
  };
  const execute = () => {
    if (!orders.length || !affordable || game.terminal !== "active") return;
    try {
      const turn = resolveTurn(game, orders);
      const combat = resolveCombat(turn.nextState, turn.events);
      const enemy = resolveEnemyTurn(combat.nextState);
      const phaseReports = [...combat.reports, ...enemy.reports];
      setGame(enemy.nextState);
      const nextReports = phaseReports.length ? phaseReports : reports;
      const nextEvents = (
        [
          ...[
            ...phaseReports.map(
              (report) =>
                `${report.target} ${report.winner} — ${report.playerCasualties} Ward casualties · ${report.enemyCasualties} hostile casualties ${report.casualties.length} casualty entries`,
            ),
            ...enemy.events.map((e) => e.message),
            ...turn.events.map((e) => e.message),
          ].map((message) => ({ turn: game.turn, message })),
          ...events,
        ].slice(0, 12)
      ) as RailEvent[];
      if (phaseReports.length) setReports(phaseReports);
      setEvents(nextEvents);
      const warning = persist(enemy.nextState, nextEvents, nextReports);
      setOrders([]);
      if (!warning && !storageWarning) setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Orders rejected");
    }
  };
  const research = (branch: ResearchBranch) => {
    try {
      const nextGame = advanceResearch(game, branch);
      setGame(nextGame);
      const warning = persist(nextGame);
      if (!warning && !storageWarning) setError("");
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
    if (warning) setError(warning);
  };
  if (!game.squads.length)
    return (
      <main className="command-shell">
        <section className="notes card">
          <p className="eyebrow">RIMEWARD // NORTHERN FRONTIER</p>
          <h1>THE WHITE LINE</h1>
          <h2>NO SURVIVORS</h2>
          <p>The Ward has no active squads. The campaign is over.</p>
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
                {game.sectors.map((s) => {
                  const [x, y] = pos[s.id];
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
                      aria-label={`${s.name}, ${s.owner} sector${scouted ? ", scouted enemy squad present" : ""}${target ? `, ${selectedAction} target` : ""}`}
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
              <div className="legend">
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
              </div>
            </section>
            <aside className="side-panel">
              {reports.length > 0 && (
                <section className="reports card">
                  <div className="panel-heading">
                    <h2>BATTLE REPORT</h2>
                    <span className="muted">RESOLVED</span>
                  </div>
                  {reports.map((report) => (
                    <article key={report.target}>
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
                        disabled={game.terminal !== "active"}
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
                <section className="research">
                  <h3>RESEARCH</h3>
                  {(
                    ["Logistics", "Warfare", "Signals"] as ResearchBranch[]
                  ).map((branch) => (
                    <button
                      disabled={
                        game.terminal !== "active" ||
                        game.researchLevels[branch] >= 2
                      }
                      key={branch}
                      onClick={() => research(branch)}
                    >
                      {branch} <b>{game.researchLevels[branch]}/2</b>
                      <small>
                        LVL {game.researchLevels[branch] + 1} ·{" "}
                        {researchCurrency(branch).toUpperCase()} ·{" "}
                        {JSON.stringify(
                          researchCost(branch, game.researchLevels[branch]),
                        )}
                      </small>
                    </button>
                  ))}
                </section>
                {expectedReports.length > 0 && (
                  <section className="expected-losses" aria-label="Expected assault losses">
                    <h3>EXPECTED ASSAULT LOSSES</h3>
                    {expectedReports.map((report) => (
                      <p key={report.target}>
                        {report.target}: Ward −{report.playerCasualties} · hostile −{report.enemyCasualties}
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
                  {game.terminal !== "active" ? (
                    <p className="muted">Campaign complete. No orders can be queued.</p>
                  ) : (
                    <>
                      {orders.length ? (
                        <ul>
                          {orders.map((order) => {
                            const unit = game.squads.find((s) => s.id === order.squadId)!;
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
                        <p className="muted">No orders queued. Choose a squad and an action to plan the turn.</p>
                      )}
                      <p className="muted">
                        Cancel leaves a squad unassigned; it does not HOLD. Unassigned squads gain fatigue when the turn executes.
                      </p>
                    </>
                  )}
                </section>
                <p className="budget" aria-label="queued resource budget">
                  QUEUED {plannedCost.metal}M + {plannedCost.energy}E · REMAINING{" "}
                  {remaining.metal}M + {remaining.energy}E BEFORE INCOME
                  {!affordable && (
                    <> · SHORT {shortfall.metal ? `${shortfall.metal}M` : ""}{shortfall.metal && shortfall.energy ? " + " : ""}{shortfall.energy ? `${shortfall.energy}E` : ""}</>
                  )}
                </p>
                <button
                  className="execute"
                  disabled={!orders.length || !affordable || game.terminal !== "active"}
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
        </>
      )}
    </main>
  );
}
