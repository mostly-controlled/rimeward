import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, battleOutcomeLabel, displayRailMessage, enemyBattleOutcomeLabel, occupationLabel } from "./App";
import {
  readSave,
  SAVE_KEY,
  SAVE_VERSION,
  writeSave,
} from "../game/persistence";
import {
  advanceResearch,
  createNewCampaign,
  resolveCombat,
  resolveEnemyTurn,
  resolveTurn,
  decideEnemyIntent,
  terminalState,
} from "../game/simulation";
const storage = globalThis as typeof globalThis & {
  localStorage: { clear(): void };
};

describe("App interactions", () => {
  it("shows legal MOVE context without generic squad or consequence prose", async () => {
    const campaign = createNewCampaign(42024);
    const root = await renderApp(campaign);
    expect(document.querySelector('[aria-label="Selected squad decision aid"]')).toBeNull();
    expect(document.querySelector(".target-scope")?.textContent).toBe("This move only; other orders and enemy response may change income.");

    const attack = [...document.querySelectorAll(".order-buttons button")].find((button) => button.textContent === "ATTACK") as HTMLButtonElement;
    await act(async () => attack.click());
    expect(document.querySelectorAll(".target-context").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("Contests this sector");
    await act(async () => root.unmount());
  });

  it("shows public objective approach and conditional income for MOVE and FREE ADVANCE", async () => {
    const campaign = createNewCampaign(42024);
    const state = {
      ...campaign,
      squads: campaign.squads.map((unit, index) => index === 0 ? { ...unit, sector: "sector-1" as const } : { ...unit, strength: 0 }),
      sectors: campaign.sectors.map((sector) => sector.id === "sector-1" ? { ...sector, owner: "player" as const } : sector),
      enemySquads: campaign.enemySquads.map((enemy) => ({ ...enemy, strength: 0 })),
    };
    const root = await renderApp(state);
    const moveTarget = [...document.querySelectorAll(".legal-targets .target-choice")].find((choice) => choice.textContent?.includes("Cairnwatch")) as HTMLElement;
    expect(moveTarget?.textContent).toContain("Northstar required relay");
    expect(moveTarget?.textContent).toContain("INCOME CHANGE PER TURN if held after enemy response: +1M +1E +0I");

    const attack = [...document.querySelectorAll(".order-buttons button")].find((button) => button.textContent === "ATTACK") as HTMLButtonElement;
    await act(async () => attack.click());
    const freeAdvanceTarget = [...document.querySelectorAll(".target-choice")].find((choice) => choice.textContent?.includes("FREE ADVANCE") && choice.textContent.includes("Cairnwatch")) as HTMLElement;
    expect(freeAdvanceTarget?.textContent).toContain("Northstar required relay");
    expect(freeAdvanceTarget?.textContent).toContain("INCOME CHANGE PER TURN if held after enemy response: +1M +1E +0I");
    await act(async () => root.unmount());
  });

  it("shows only still-required objectives, including co-located HQ and relay", async () => {
    const campaign = createNewCampaign(42024);
    const quietEnemies = campaign.enemySquads.map((enemy) => ({ ...enemy, strength: 0 }));
    const glasswayState = {
      ...campaign,
      squads: campaign.squads.map((unit, index) => index === 0 ? { ...unit, sector: "sector-4" as const } : { ...unit, strength: 0 }),
      enemySquads: quietEnemies,
    };
    const glasswayRoot = await renderApp(glasswayState);
    const glassway = [...document.querySelectorAll(".target-choice")].find((choice) => choice.textContent?.includes("Glassway")) as HTMLElement;
    expect(glassway?.textContent).toContain("Ashenfall enemy HQ + required relay");
    expect(glassway?.textContent).toContain("INCOME CHANGE PER TURN if held after enemy response: +0M +0E +0I");
    await act(async () => glasswayRoot.unmount());

    const capturedRoot = await renderApp({
      ...campaign,
      squads: campaign.squads.map((unit, index) => index === 0 ? { ...unit, sector: "sector-4" as const } : { ...unit, strength: 0 }),
      sectors: campaign.sectors.map((sector) => sector.id === "sector-6" ? { ...sector, owner: "player" as const } : sector),
      objectives: campaign.objectives.map((objective) => objective.sector === "sector-6" ? { ...objective, controlled: true } : objective),
      enemySquads: quietEnemies,
    });
    const captured = [...document.querySelectorAll(".target-choice")].find((choice) => choice.textContent?.includes("Glassway")) as HTMLElement;
    expect(captured?.textContent).not.toContain("Ashenfall enemy HQ");
    expect(captured?.textContent).not.toContain("required relay");
    await act(async () => capturedRoot.unmount());
  });

  it("distinguishes already-owned, unconnected, and reconnection income outcomes", async () => {
    const campaign = createNewCampaign(42024);
    const livingAt = (sector: "sector-0" | "sector-1") => campaign.squads.map((unit, index) => index === 0 ? { ...unit, sector } : { ...unit, strength: 0 });
    const quietEnemies = campaign.enemySquads.map((enemy) => ({ ...enemy, strength: 0 }));

    const alreadyOwned = await renderApp({
      ...campaign,
      squads: livingAt("sector-0"),
      sectors: campaign.sectors.map((sector) => sector.id === "sector-1" ? { ...sector, owner: "player" as const } : sector),
      enemySquads: quietEnemies,
    });
    const alreadyChoice = [...document.querySelectorAll(".target-choice")].find((choice) => choice.textContent?.includes("Whiteplain")) as HTMLElement;
    expect(alreadyChoice?.textContent).toContain("INCOME CHANGE PER TURN if held after enemy response: +0M +0E +0I · already owned");
    expect(alreadyChoice?.textContent).not.toContain("Ward HQ");
    await act(async () => alreadyOwned.unmount());

    const disconnected = await renderApp({
      ...campaign,
      squads: livingAt("sector-1"),
      enemySquads: quietEnemies,
    });
    const disconnectedChoice = [...document.querySelectorAll(".target-choice")].find((choice) => choice.textContent?.includes("Cairnwatch")) as HTMLElement;
    expect(disconnectedChoice?.textContent).toContain("INCOME CHANGE PER TURN if held after enemy response: +0M +0E +0I · unconnected");
    await act(async () => disconnected.unmount());

    const reconnection = await renderApp({
      ...campaign,
      squads: livingAt("sector-0"),
      sectors: campaign.sectors.map((sector) => sector.id === "sector-2" ? { ...sector, owner: "player" as const } : sector),
      enemySquads: quietEnemies,
    });
    const reconnectionChoice = [...document.querySelectorAll(".target-choice")].find((choice) => choice.textContent?.includes("Whiteplain")) as HTMLElement;
    expect(reconnectionChoice?.textContent).toContain("INCOME CHANGE PER TURN if held after enemy response: +1M +1E +0I · reconnects 1 owned sector");
    await act(async () => reconnection.unmount());
  });

  it("discloses no enemy inference at Signals 0 while keeping the choice-list caveat concise", async () => {
    const campaign = createNewCampaign(42024);
    const state = {
      ...campaign,
      researchLevels: { ...campaign.researchLevels, Signals: 0 },
      squads: campaign.squads.map((unit, index) => index === 0 ? { ...unit, sector: "sector-0" as const } : { ...unit, strength: 0 }),
      enemySquads: campaign.enemySquads.map((enemy, index) => index === 0 ? { ...enemy, class: "Recon" as const, sector: "sector-0" as const, strength: 5 } : { ...enemy, strength: 0 }),
      revealedEnemySquads: ["enemy-1"],
    };
    const root = await renderApp(state);
    const legalTargets = document.querySelector(".legal-targets") as HTMLElement;
    expect(legalTargets.textContent).toContain("Enemy response unknown without Signals.");
    expect((legalTargets.textContent?.match(/Enemy response unknown without Signals\./g) ?? [])).toHaveLength(1);
    expect(legalTargets.textContent).not.toContain("Recon");
    expect(legalTargets.textContent).not.toContain("enemy-1");
    expect(document.querySelector(".scouted-warning")).toBeNull();
    await act(async () => root.unmount());
  });

  it("filters scouted nearby warnings by Signals, reveal, strength, and destination adjacency", async () => {
    const campaign = createNewCampaign(42024);
    const base = {
      ...campaign,
      squads: campaign.squads.map((unit, index) => index === 0 ? { ...unit, sector: "sector-0" as const } : { ...unit, strength: 0 }),
      enemySquads: [...campaign.enemySquads.map((enemy, index) => index === 0
        ? { ...enemy, class: "Recon" as const, sector: "sector-0" as const, strength: 5 }
        : index === 1
          ? { ...enemy, class: "Raider" as const, sector: "sector-0" as const, strength: 5 }
          : index === 2
            ? { ...enemy, class: "Sentinel" as const, sector: "sector-0" as const, strength: 0 }
            : { ...enemy, strength: 0 }), {
        ...campaign.enemySquads[0],
        id: "enemy-4",
        class: "Artillery" as const,
        sector: "sector-3" as const,
        strength: 5,
      }],
    };
    expect(base.enemySquads).toHaveLength(4);
    const hidden = await renderApp({ ...base, researchLevels: { ...base.researchLevels, Signals: 0 }, revealedEnemySquads: ["enemy-1", "enemy-3", "enemy-4"] });
    const hiddenTarget = [...document.querySelectorAll(".legal-targets button")].find((button) => button.textContent?.includes("Lastlight")) as HTMLButtonElement;
    await act(async () => hiddenTarget.click());
    expect(document.querySelector(".scouted-warning")).toBeNull();
    await act(async () => hidden.unmount());
    const visible = await renderApp({ ...base, researchLevels: { ...base.researchLevels, Signals: 1 }, revealedEnemySquads: ["enemy-1", "enemy-3", "enemy-4"] });
    const target = [...document.querySelectorAll(".legal-targets button")].find((button) => button.textContent?.includes("Lastlight")) as HTMLButtonElement;
    await act(async () => target.click());
    const warningText = [...document.querySelectorAll(".scouted-warning")].map((warning) => warning.textContent).join(" ");
    expect(warningText).toContain("Recon at Frostgate");
    expect(warningText).not.toContain("Raider");
    expect(warningText).not.toContain("Sentinel");
    expect(warningText).not.toContain("Artillery");
    await act(async () => visible.unmount());
  });

  it("uses the queued MOVE target after selection changes and clears warnings on turn change", async () => {
    const campaign = createNewCampaign(42024);
    const state = { ...campaign, researchLevels: { ...campaign.researchLevels, Signals: 1 }, revealedEnemySquads: ["enemy-1"], enemySquads: campaign.enemySquads.map((enemy, index) => index === 0 ? { ...enemy, sector: "sector-0" as const, strength: 5 }  : index === 2 ? { ...enemy, sector: "sector-3" as const, strength: 5 } : { ...enemy, strength: 0 }) };
    const root = await renderApp(state);
    await act(async () => (document.querySelector(".squad-card") as HTMLButtonElement).click());
    await act(async () => (document.querySelector(".order-buttons button") as HTMLButtonElement).click());
    const target = [...document.querySelectorAll(".legal-targets button")].find((button) => button.textContent?.includes("Lastlight")) as HTMLButtonElement;
    await act(async () => target.click());
    await act(async () => (document.querySelectorAll(".squad-card")[1] as HTMLButtonElement).click());
    expect([...document.querySelectorAll(".queued-order")].some((entry) => entry.textContent?.includes("Scouted nearby: Recon at Frostgate"))).toBe(true);
    await act(async () => (document.querySelector(".execute") as HTMLButtonElement).click());
    expect(document.querySelector(".queued-order .scouted-warning")).toBeNull();
    await act(async () => root.unmount());
  });
  it("preserves the seeded Raider move/attack reports with faction-correct enemy labels", async () => {
    const root = await renderApp(createNewCampaign(58386330));
    expect(document.querySelector(".action-feedback")).toBeNull();
    const named = (label: string) => [...document.querySelectorAll("button")].find((button) => button.textContent?.includes(label)) as HTMLButtonElement;
    const execute = async () => await act(async () => (document.querySelector(".execute") as HTMLButtonElement).click());

    await act(async () => named("MOVE").click());
    await act(async () => named("Whiteplain").click());
    await execute();
    expect(document.querySelector(".turn-readout")?.textContent).toContain("02");
    expect(document.querySelector(".action-feedback")?.textContent).toBeTruthy();
    expect(document.querySelector('[aria-label="Resolved actions for turn 1"]')).toBeTruthy();

    await act(async () => named("ATTACK").click());
    const attackTarget = named("Cairnwatch");
    expect(attackTarget).toBeTruthy();
    await act(async () => attackTarget.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await execute();
    const report = document.querySelector(".reports")?.textContent ?? "";
    expect(report).toContain("Cairnwatch");
    expect(report).toContain("WARD DEFENDERS Sentinel 9/10");
    expect(report).toContain("HOSTILE ATTACKERS Artillery 5/8");
    expect(report).toContain("SURVIVORS: HOSTILE 5; WARD 9");
    expect(document.querySelector('[aria-label="Resolved actions for turn 1"]')).toBeNull();
    expect(document.querySelector('[aria-label="Resolved actions for turn 2"]')).toBeTruthy();
    await act(async () => root.unmount());
  });

  it("offers a legal free advance that replaces only the selected attack", async () => {
    const root = await renderApp(createNewCampaign(42024));
    const attack = [...document.querySelectorAll(".order-buttons button")].find((button) => button.textContent === "ATTACK") as HTMLButtonElement;
    await act(async () => attack.click());
    const target = document.querySelector('.legal-targets button:not(.free-advance)') as HTMLButtonElement;
    expect(target).toBeTruthy();
    expect(document.querySelectorAll(".free-advance").length).toBeGreaterThan(0);
    await act(async () => target.click());
    expect(document.querySelector(".queued-order")?.textContent).toContain("ATTACK");
    const advance = document.querySelector('.queued-order .free-advance') as HTMLButtonElement;
    expect(advance).toBeTruthy();
    await act(async () => advance.click());
    expect(document.querySelector(".queued-order")?.textContent).toContain("MOVE");
    expect(document.querySelector(".queued-order")?.textContent).not.toContain("ATTACK");
    expect(document.querySelector('[aria-label="queued resource budget"]')?.textContent).toContain("QUEUED 0M + 0E");
    await act(async () => root.unmount());
  });


  it("replaces an earlier squad attack without changing the later squad order", async () => {
    const root = await renderApp(createNewCampaign(42024));
    const squad = (index: number) => document.querySelectorAll(".squad-card")[index] as HTMLButtonElement;
    const action = (label: string) => [...document.querySelectorAll(".order-buttons button")].find((button) => button.textContent === label) as HTMLButtonElement;
    const target = (label: string) => [...document.querySelectorAll(".legal-targets button:not(.free-advance)")].find((button) => button.textContent === label) as HTMLButtonElement;

    await act(async () => squad(0).click());
    await act(async () => action("ATTACK").click());
    await act(async () => target("ATTACK → Whiteplain").click());
    await act(async () => squad(1).click());
    await act(async () => action("ATTACK").click());
    await act(async () => target("ATTACK → Whiteplain").click());

    const queuedAttack = [...document.querySelectorAll(".queued-order")].find((entry) => entry.textContent?.includes("SENTINEL squad-1"))?.querySelector('[aria-label="Replace queued attack with free advance to Whiteplain"]') as HTMLButtonElement;
    expect(queuedAttack).toBeTruthy();
    await act(async () => queuedAttack.click());

    expect([...document.querySelectorAll(".plan-entry")].map((entry) => entry.getAttribute("aria-label"))).toEqual([
      "Queued order squad-2 attack Whiteplain",
      "Queued order squad-1 move Whiteplain",
    ]);
    expect([...document.querySelectorAll(".planned-order")].map((order) => ({
      orderId: order.getAttribute("data-order-id"),
      target: order.getAttribute("data-target"),
    }))).toEqual([
      { orderId: "squad-2", target: "sector-1" },
      { orderId: "squad-1", target: "sector-1" },
    ]);
    expect(document.querySelector('[aria-label="queued resource budget"]')?.textContent).toContain("QUEUED 2M + 3E");
    expect(document.querySelector('.planned-marker-1')?.getAttribute("aria-label")).toContain("PLAN · MOVE · SENTINEL M1 to Whiteplain");
    expect(document.querySelector('.planned-marker-1')?.querySelector("text")?.textContent).toBe("M1");
    expect(document.querySelector('.planned-order[data-order-id="squad-1"] .planned-attack')).toBeNull();
    expect(document.querySelector('.planned-order[data-order-id="squad-2"] .planned-attack')).toBeTruthy();
    await act(async () => root.unmount());
  });
  it("does not offer free advance for occupied or illegal move targets and retains other orders", async () => {
    const campaign = createNewCampaign(42024);
    const state = {
      ...campaign,
      squads: campaign.squads.map((unit, index) => index === 0 ? { ...unit, sector: "sector-0" as const } : index === 1 ? { ...unit, sector: "sector-1" as const } : { ...unit, strength: 0 }),
      enemySquads: campaign.enemySquads.map((enemy, index) => index === 0 ? { ...enemy, sector: "sector-1" as const } : { ...enemy, strength: 0 }),
    };
    const root = await renderApp(state);
    await act(async () => (document.querySelectorAll(".squad-card")[1] as HTMLButtonElement).click());
    await act(async () => (document.querySelector('.order-buttons button') as HTMLButtonElement).click());
    await act(async () => (document.querySelectorAll(".squad-card")[0] as HTMLButtonElement).click());
    await act(async () => ([...document.querySelectorAll(".order-buttons button")].find((button) => button.textContent === "ATTACK") as HTMLButtonElement).click());
    const occupiedTarget = [...document.querySelectorAll(".target-choice")].find((choice) => choice.textContent?.includes("Whiteplain"));
    expect(occupiedTarget?.querySelector(".free-advance")).toBeNull();
    expect(document.querySelector(".queued-order")?.textContent).toContain("HOLD");
    expect(document.querySelector('[aria-label="Legal attack targets"]')?.textContent).toContain("Whiteplain");
    await act(async () => root.unmount());
  });

  it("keeps engagement outcome separate from occupation", () => {
    expect(battleOutcomeLabel({ winner: "player", captured: false })).toBe("won; not captured");
    expect(occupationLabel({ captured: false, relayControlled: false })).toBe("occupation: no change");
    expect(occupationLabel({ captured: true, relayControlled: true })).toBe("occupation: captured");
  });
  const renderApp = async (initialGame = createNewCampaign(42024)) => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App initialGame={initialGame} />));
    const continueButton = [...document.querySelectorAll("button")].find((button) => button.textContent?.startsWith("CONTINUE"));
    if (continueButton) await act(async () => (continueButton as HTMLButtonElement).click());
    return root;
  };

  it("shows the seeded human style and no-pattern cue before commitment", async () => {
    // Synthetic fixture: this does not claim normal-campaign browser coverage.
    const campaign = createNewCampaign(42024);
    const state = {
      ...campaign,
      squads: campaign.squads.map((squad, index) =>
        index === 0 ? { ...squad, sector: "sector-0" as const } : { ...squad, strength: 0 },
      ),
      enemySquads: campaign.enemySquads.map((enemy, index) =>
        index === 0 ? { ...enemy, sector: "sector-1" as const, strength: 7 } : { ...enemy, strength: 0 },
      ),
    };
    const root = await renderApp(state);
    const cue = document.querySelector('[aria-label="Enemy style cue"]')?.textContent ?? "";
    expect(cue).toContain("ENEMY STYLE CUE");
    expect(cue).toMatch(/Aggressive raider|Defensive planner/);
    expect(cue).toContain("gathering observations");
    expect(cue).not.toMatch(/UNSET|enemy pattern|enemy order/i);
    await act(async () => root.unmount());
  });

  it("keeps human style names while showing partial adaptive states", async () => {
    const campaign = createNewCampaign(42024);
    const state = {
      ...campaign,
      turn: 2,
      adaptiveHistory: [{ turn: 1, observations: [{ kind: "move" as const, class: "Raider" as const, from: "sector-1" as const, to: "sector-2" as const }] }],
    };
    const root = await renderApp(state);
    const cue = document.querySelector('[aria-label="Enemy style cue"]')?.textContent ?? "";
    expect(cue).toMatch(/Aggressive raider|Defensive planner/);
    expect(cue).toContain("gathering observations");
    expect(cue).not.toContain("UNSET");
    expect(cue).not.toContain("Adaptive commander");
    expect(cue).not.toContain("response uncertain");
    expect((cue.match(/Aggressive raider|Defensive planner/g) ?? [])).toHaveLength(1);
    await act(async () => root.unmount());
  });

  it("shows local observation feedback for collection, repetition, and a broken pattern", async () => {
    const campaign = createNewCampaign(42024);
    const root = await renderApp({ ...campaign, turn: 2, adaptiveHistory: [{ turn: 1, observations: [{ kind: "move", class: "Raider", from: "sector-1", to: "sector-2" }] }] });
    expect(document.querySelector('[aria-label="Enemy style cue"]')?.textContent).toContain("gathering observations");
    await act(async () => root.unmount());
    const repeated = await renderApp({ ...campaign, turn: 3, adaptiveHistory: [
      { turn: 1, observations: [{ kind: "move", class: "Raider", from: "sector-1", to: "sector-2" }] },
      { turn: 2, observations: [{ kind: "attack", class: "Raider", from: "sector-1", target: "sector-0" }] },
    ] });
    expect(document.querySelector('[aria-label="Enemy style cue"]')?.textContent).toContain("repeated observed class: Raider");
    await act(async () => repeated.unmount());
    const broken = await renderApp({ ...campaign, turn: 3, adaptiveHistory: [
      { turn: 1, observations: [{ kind: "move", class: "Raider", from: "sector-1", to: "sector-2" }] },
      { turn: 2, observations: [{ kind: "move", class: "Raider", from: "sector-2", to: "sector-3" }] },
      { turn: 3, observations: [{ kind: "move", class: "Sentinel", from: "sector-3", to: "sector-4" }] },
    ] });
    expect(document.querySelector('[aria-label="Enemy style cue"]')?.textContent).toContain("pattern broken");
    await act(async () => broken.unmount());
  });

  it("sanitizes persisted legacy enemy debriefs without Signals", () => {
    const legacy = "TURN 4 DEBRIEF\nENEMY PHASE OBSERVED: enemy-1 move sector-3";
    expect(displayRailMessage(legacy, 0)).toContain("movement withheld — Signals 0");
    expect(displayRailMessage(legacy, 0)).not.toContain("enemy-1");
    expect(displayRailMessage(legacy, 1)).toBe(legacy);
  });

  it("shows human-readable local observation feedback with an actionable implication", async () => {
    const campaign = createNewCampaign(42024);
    const initialGame = {
      ...campaign,
      turn: 3,
      adaptiveHistory: [
        { turn: 1, observations: [{ kind: "move" as const, class: "Raider" as const, from: "sector-0" as const, to: "sector-1" as const }] },
        { turn: 2, observations: [{ kind: "move" as const, class: "Raider" as const, from: "sector-1" as const, to: "sector-5" as const }] },
      ],
    };
    const root = await renderApp(initialGame);
    const cue = document.querySelector('[aria-label="Enemy style cue"]')?.textContent ?? "";
    expect(cue).toContain("repeated observed class: Raider");
    expect(cue).toContain("LOCAL OBSERVATIONS ONLY");
    await act(async () => root.unmount());
  });

  it("renders a real temporary relay capture and enemy recapture", async () => {
    const campaign = createNewCampaign(42024);
    const initialGame = {
      ...campaign,
      squads: campaign.squads.map((unit) => unit.id === "squad-2" ? { ...unit, sector: "sector-2" as const, strength: 1 } : unit),
      enemySquads: campaign.enemySquads.map((enemy, index) => index === 0 ? { ...enemy, sector: "sector-4" as const, strength: 9 } : enemy),
    };
    const orders = [{ squadId: "squad-2", type: "attack" as const, target: "sector-3" as const }];
    const turn = resolveTurn(initialGame, orders);
    const combat = resolveCombat(turn.nextState, turn.events);
    const enemy = resolveEnemyTurn(combat.nextState);
    expect(initialGame.sectors.find((sector) => sector.id === "sector-3")?.owner).toBe("neutral");
    expect(combat.nextState.sectors.find((sector) => sector.id === "sector-3")?.owner).toBe("player");
    expect(enemy.nextState.sectors.find((sector) => sector.id === "sector-3")?.owner).toBe("enemy");
    expect(enemy.reports.some((report) => report.target === "sector-3" && report.winner === "enemy" && report.captured)).toBe(true);

    const root = await renderApp(initialGame);
    await act(async () => (document.querySelectorAll(".squad-card")[1] as HTMLButtonElement).click());
    await act(async () => (document.querySelector("button[aria-pressed=\"true\"]") as HTMLButtonElement).click());
    await act(async () => (document.querySelector('[role="button"][aria-label*="Northstar"]') as SVGGElement).dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => (document.querySelector(".execute") as HTMLButtonElement).click());
    const debrief = document.querySelector('[aria-label="Last turn debrief"]')?.textContent ?? "";
    expect(debrief).toContain("Northstar: neutral → player → enemy");
    expect(debrief).toContain("SQUAD LOSSES:");
    await act(async () => root.unmount());
  });

  it("sanitizes a persisted legacy debrief through App render and reload", async () => {
    const game = createNewCampaign(42024);
    writeSave({
      version: SAVE_VERSION,
      game,
      events: [{ turn: 4, message: "TURN 4 DEBRIEF\nENEMY PHASE OBSERVED: enemy-1 move sector-3" }],
      reports: [],
    });
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App />));
    await act(async () => (document.querySelector('button') as HTMLButtonElement | null)?.click());
    const details = document.querySelector("details summary") as HTMLElement;
    await act(async () => details.click());
    const firstRender = document.querySelector('[aria-label="Last turn debrief"]')?.textContent ?? "";
    expect(firstRender).toContain("movement withheld — Signals 0");
    expect(firstRender).not.toContain("enemy-1");
    await act(async () => root.unmount());
    document.body.innerHTML = '<div id="root"></div>';
    const reloaded = createRoot(document.getElementById("root")!);
    await act(async () => reloaded.render(<App />));
    await act(async () => ([...document.querySelectorAll("button")].find((button) => button.textContent?.startsWith("CONTINUE")) as HTMLButtonElement).click());
    const reloadDetails = document.querySelector("details summary") as HTMLElement;
    await act(async () => reloadDetails.click());
    const secondRender = document.querySelector('[aria-label="Last turn debrief"]')?.textContent ?? "";
    expect(secondRender).not.toContain("enemy-1");
    await act(async () => reloaded.unmount());
  });

  it("renders the proven T4 recovery as before, player phase, and enemy response", async () => {
    const step = (state: ReturnType<typeof createNewCampaign>, orders: Parameters<typeof resolveTurn>[1]) => {
      const player = resolveTurn(state, orders);
      const combat = resolveCombat(player.nextState, player.events);
      return { state: resolveEnemyTurn(combat.nextState).nextState, combat, enemy: resolveEnemyTurn(combat.nextState) };
    };
    let state = createNewCampaign(42024);
    const holdAll = () => state.squads.filter((unit) => unit.strength > 0).map((unit) => ({ squadId: unit.id, type: "hold" as const }));
    state = step(state, holdAll()).state;
    state = step(state, [{ squadId: "squad-2", type: "move", target: "sector-1" }, { squadId: "squad-3", type: "move", target: "sector-11" }, ...state.squads.filter((unit) => !["squad-2", "squad-3"].includes(unit.id) && unit.strength > 0).map((unit) => ({ squadId: unit.id, type: "hold" as const }))]).state;
    const t3 = step(state, [{ squadId: "squad-2", type: "attack", target: "sector-2" }, ...state.squads.filter((unit) => unit.id !== "squad-2" && unit.strength > 0).map((unit) => ({ squadId: unit.id, type: "hold" as const }))]);
    expect(t3.enemy.reports.some((report) => report.winner === "enemy" && !report.captured)).toBe(true);
    const before = t3.state;
    const t4 = step(before, [{ squadId: "squad-2", type: "recover" }, ...before.squads.filter((unit) => unit.id !== "squad-2" && unit.strength > 0).map((unit) => ({ squadId: unit.id, type: "hold" as const }))]);
    const root = await renderApp(before);
    await act(async () => (document.querySelectorAll(".squad-card")[1] as HTMLButtonElement).click());
    await act(async () => (document.querySelectorAll(".order-buttons button")[1] as HTMLButtonElement).click());
    await act(async () => (document.querySelector(".execute") as HTMLButtonElement).click());
    const debrief = document.querySelector('[aria-label="Last turn debrief"]')?.textContent ?? "";
    const playerStrength = t4.combat.nextState.squads.find((unit) => unit.id === "squad-2")?.strength;
    const finalStrength = t4.state.squads.find((unit) => unit.id === "squad-2")?.strength;
    const beforeStrength = before.squads.find((unit) => unit.id === "squad-2")?.strength;
    expect(playerStrength).toBeGreaterThan(beforeStrength!);
    expect(finalStrength).toBeLessThan(playerStrength!);
    expect(debrief).toContain(`STR ${beforeStrength}→${playerStrength}→${finalStrength}`);
    await act(async () => root.unmount());
  });

  it("cycles NEXT UNASSIGNED past assigned and dead squads, including roster wrap", async () => {
    const campaign = createNewCampaign(42024);
    const initialGame = { ...campaign, squads: campaign.squads.map((unit, index) => index === 1 ? { ...unit, strength: 0 } : unit) };
    const root = await renderApp(initialGame);
    const next = () => document.querySelector(".queued-orders button:nth-of-type(2)") as HTMLButtonElement;
    await act(async () => (document.querySelectorAll(".squad-card")[0] as HTMLButtonElement).click());
    await act(async () => next().click());
    expect(document.querySelector(".squad-card.chosen")?.textContent).toContain("RECON");
    await act(async () => next().click());
    expect(document.querySelector(".squad-card.chosen")?.textContent).toContain("ARTILLERY");
    await act(async () => next().click());
    expect(document.querySelector(".squad-card.chosen")?.textContent).toContain("SENTINEL // 05");
    await act(async () => next().click());
    expect(document.querySelector(".squad-card.chosen")?.textContent).toContain("SENTINEL // 01");
    await act(async () => root.unmount());
  });

  it("retains the sole eligible squad and disables NEXT UNASSIGNED when all are assigned", async () => {
    const campaign = createNewCampaign(42024);
    const only = { ...campaign, squads: campaign.squads.map((unit, index) => ({ ...unit, strength: index === 2 ? 5 : 0 })) };
    const root = await renderApp(only);
    const next = document.querySelector(".queued-orders button:nth-of-type(2)") as HTMLButtonElement;
    await act(async () => next.click());
    expect(document.querySelector(".squad-card.chosen")?.textContent).toContain("RECON");
    expect(next.disabled).toBe(false);
    await act(async () => root.unmount());
    const assignedRoot = await renderApp(campaign);
    await act(async () => (document.querySelector(".queued-orders button") as HTMLButtonElement).click());
    expect((document.querySelector(".queued-orders button:nth-of-type(2)") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => assignedRoot.unmount());
  });

  it("restores canceled eligibility and disables NEXT UNASSIGNED in terminal state", async () => {
    const campaign = createNewCampaign(42024);
    const root = await renderApp(campaign);
    await act(async () => (document.querySelector(".order-buttons button") as HTMLButtonElement).click());
    const next = document.querySelector(".queued-orders button:nth-of-type(2)") as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    await act(async () => (document.querySelector("button[aria-label^=\"Cancel\"]") as HTMLButtonElement).click());
    expect(next.disabled).toBe(false);
    await act(async () => root.unmount());
    const terminalRoot = await renderApp({ ...campaign, terminal: "victory", terminalReason: "done" });
    expect((document.querySelector(".queued-orders button:nth-of-type(2)") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => terminalRoot.unmount());
  });

  it("shows grouped living Ward counts at actual sectors with an accessible legend", async () => {
    const campaign = createNewCampaign(42024);
    const sector = campaign.squads[0].sector;
    const initialGame = {
      ...campaign,
      squads: campaign.squads.map((unit, index) => index < 2 ? { ...unit, sector, strength: index === 0 ? 4 : 6 } : { ...unit, strength: 0 }),
    };
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App initialGame={initialGame} />));
    const badge = document.querySelector(".ward-strength-badge");
    expect(badge?.textContent).toBe("2");
    expect(badge?.getAttribute("aria-label")).toBe("2 living Ward squads");
    const sectorButton = [...document.querySelectorAll('[role="button"]')].find((button) => button.querySelector(".ward-strength-badge"));
    expect(sectorButton?.getAttribute("aria-label")).toContain("2 living Ward squads");
    expect(document.querySelectorAll(".ward-strength-badge")).toHaveLength(1);
    expect(document.querySelector(".ward-legend")?.textContent).toBe("Ward squads");
    await act(async () => root.unmount());
  });
  it("updates split Ward counts after queued movement executes", async () => {
    const campaign = createNewCampaign(42024);
    const origin = campaign.squads[0].sector;
    const initialGame = {
      ...campaign,
      squads: campaign.squads.map((unit, index) => index < 2 ? { ...unit, sector: origin, strength: 5 } : { ...unit, strength: 0 }),
    };
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App initialGame={initialGame} />));
    expect(document.querySelectorAll(".ward-strength-badge")).toHaveLength(1);
    const target = document.querySelector('[role="button"][aria-label*="Whiteplain"]') as SVGGElement;
    await act(async () => target.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => (document.querySelector(".execute") as HTMLButtonElement).click());
    expect(document.querySelectorAll(".ward-strength-badge")).toHaveLength(2);
    expect([...document.querySelectorAll(".ward-strength-badge")].map((badge) => badge.textContent)).toEqual(["1", "1"]);
    await act(async () => root.unmount());
  });
  it("reports a winning attack without capture truthfully", () => {
    expect(battleOutcomeLabel({ winner: "player", captured: false })).toBe("won; not captured");
    expect(battleOutcomeLabel({ winner: "player", captured: true })).toBe("captured");
  });

  it("updates the turn guide from selection, queue, cancel, execute, and terminal state", async () => {
    const campaign = createNewCampaign(42024);
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App initialGame={campaign} />));
    expect(
      document.querySelector('[aria-label="Turn guide"]')?.textContent,
    ).toContain("GOAL");
    expect(
      document.querySelector('[aria-label="Turn guide"]')?.textContent,
    ).toContain("SELECT SQUAD");
    const help = document.querySelector(".turn-help") as HTMLDetailsElement;
    expect(help.open).toBe(false);
    expect(help.querySelector("summary")?.textContent).toBe("How to plan a turn");
    await act(async () => (help.querySelector("summary") as HTMLElement).click());
    expect(help.open).toBe(true);
    const target = document.querySelector(
      '[role="button"][aria-label*="Whiteplain"]',
    ) as SVGGElement;
    await act(async () =>
      target.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(
      document.querySelector('[aria-label="Turn guide"]')?.textContent,
    ).toContain("QUEUED (1)");
    const cancel = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "CANCEL",
    ) as HTMLButtonElement;
    await act(async () => cancel.click());
    expect(
      document.querySelector('[aria-label="Turn guide"]')?.textContent,
    ).toContain("NOT QUEUED");
    await act(async () =>
      target.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    await act(async () =>
      (document.querySelector(".execute") as HTMLButtonElement).click(),
    );
    expect(
      document.querySelector('[aria-label="Turn guide"]')?.textContent,
    ).toContain("TURN 2");
    await act(async () => root.unmount());

    document.body.innerHTML = '<div id="root"></div>';
    const terminal = {
      ...campaign,
      terminal: "victory" as const,
      terminalReason: "secured",
    };
    const terminalRoot = createRoot(document.getElementById("root")!);
    await act(async () => terminalRoot.render(<App initialGame={terminal} />));
    expect(
      document.querySelector('[aria-label="Turn guide"]')?.textContent,
    ).toContain("Terminal state: VICTORY");
    await act(async () => terminalRoot.unmount());
  });

  it("shows saved turn-5 state and global queue truth for another squad", async () => {
    const campaign = createNewCampaign(42024);
    writeSave({
      version: SAVE_VERSION,
      game: { ...campaign, turn: 5 },
      events: [],
      reports: [],
    });
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App />));
    await act(async () => (document.querySelector('button') as HTMLButtonElement | null)?.click());
    const target = document.querySelector(
      '[role="button"][aria-label*="Whiteplain"]',
    ) as SVGGElement;
    await act(async () =>
      target.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    await act(async () =>
      (
        document.querySelectorAll(".squad-card")[1] as HTMLButtonElement
      ).click(),
    );
    const guide =
      document.querySelector('[aria-label="Turn guide"]')?.textContent ?? "";
    expect(guide).toContain("TURN 5");
    expect(guide).toContain("QUEUED (1)");
    expect(guide).toContain("4 unassigned squads; choose another or HOLD UNASSIGNED to avoid fatigue");
    await act(async () => root.unmount());
  });

  it("gives a state-correct fallback when attack has zero legal targets", async () => {
    const campaign = createNewCampaign(42024);
    const firstSector = campaign.squads[0].sector;
    const reachable = campaign.sectors.find(
      (sector) => sector.id === firstSector,
    )!.links;
    const blocked = {
      ...campaign,
      sectors: campaign.sectors.map((sector) =>
        reachable.includes(sector.id)
          ? { ...sector, owner: "player" as const }
          : sector,
      ),
    };
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App initialGame={blocked} />));
    await act(async () =>
      (
        document.querySelector(
          'button[aria-pressed="false"]',
        ) as HTMLButtonElement
      ).click(),
    );
    const guide =
      document.querySelector('[aria-label="Turn guide"]')?.textContent ?? "";
    expect(guide).toContain("NO LEGAL TARGETS");
    expect(guide).toContain("no enemy target is reachable");
    expect(guide).not.toContain("select ATTACK");
    await act(async () => root.unmount());
  });

  it("keeps goal, guide, and tactical controls ahead of secondary telemetry", async () => {
    const campaign = { ...createNewCampaign(42024), turn: 5 };
    writeSave({
      version: SAVE_VERSION,
      game: campaign,
      events: [],
      reports: [],
    });
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App />));
    await act(async () => ([...document.querySelectorAll("button")].find((button) => button.textContent?.startsWith("CONTINUE")) as HTMLButtonElement).click());
    const objectives = document.querySelector(".campaign-objectives")!;
    const guide = document.querySelector('[aria-label="Turn guide"]')!;
    const map = document.querySelector(".battle-layout")!;
    const telemetry = document.querySelector(".income")!;
    expect(
      guide.compareDocumentPosition(objectives) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      guide.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      map.compareDocumentPosition(telemetry) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(guide.textContent).toContain("TURN 5");
    await act(async () => root.unmount());
  });

  it("guides an unsupplied squad toward HOLD or changing squad", async () => {
    const campaign = createNewCampaign(42024);
    const unsuppliedSquad = {
      ...campaign.squads[0],
      sector: "sector-6" as const,
    };
    const reachable = campaign.sectors.find(
      (sector) => sector.id === unsuppliedSquad.sector,
    )!.links;
    const unsupplied = {
      ...campaign,
      sectors: campaign.sectors.map((sector) =>
        reachable.includes(sector.id)
          ? { ...sector, owner: "player" as const }
          : sector,
      ),
      squads: campaign.squads.map((s, i) => (i === 0 ? unsuppliedSquad : s)),
    };
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App initialGame={unsupplied} />));
    await act(async () =>
      (
        document.querySelector(
          '.order-buttons button[aria-pressed="false"]',
        ) as HTMLButtonElement
      ).click(),
    );
    const guide =
      document.querySelector('[aria-label="Turn guide"]')?.textContent ?? "";
    expect(guide).toContain("HOLD or change squad");
    expect(guide).not.toContain("use HOLD or RECOVER");
    await act(async () => root.unmount());
  });

  it("describes ATTACK as conditional on a legal target", async () => {
    const campaign = createNewCampaign(42024);
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App initialGame={campaign} />));
    await act(async () =>
      (
        document.querySelector(
          '.order-buttons button[aria-pressed="false"]',
        ) as HTMLButtonElement
      ).click(),
    );
    const guide =
      document.querySelector('[aria-label="Turn guide"]')?.textContent ?? "";
    expect(guide).toContain("choose a legal target below to queue ATTACK");
    expect(guide).not.toContain("objective is adjacent");
    await act(async () => root.unmount());
  });

  it("places the guide first and states the relay/HQ roles", async () => {
    const campaign = createNewCampaign(42024);
    const root = await renderApp(campaign);
    const guide = document.querySelector('[aria-label="Turn guide"]')!;
    const resources = document.querySelector(".resource-strip")!;
    const objectives = document.querySelector(".campaign-objectives")!;
    expect(guide.compareDocumentPosition(resources) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(guide.compareDocumentPosition(objectives) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(guide.textContent).toContain("Hold all relays AND enemy HQ; defend Frostgate.");
    expect(guide.textContent).toContain("Remaining relays: Northstar, Ashenfall, Vesper. HQ: Ashenfall REQUIRED");
    expect(guide.textContent).toContain("Objectives may not be reachable this turn.");
    await act(async () => root.unmount());
  });

  it("uses the zero-unassigned completion guidance and selected HOLD action", async () => {
    const campaign = createNewCampaign(42024);
    const root = await renderApp(campaign);
    const hold = [...document.querySelectorAll("button")].find((button) => button.textContent === "HOLD UNASSIGNED") as HTMLButtonElement;
    await act(async () => hold.click());
    const guide = document.querySelector('[aria-label="Turn guide"]')?.textContent ?? "";
    expect(guide).toContain("0 unassigned squads;");
    expect(guide).toContain("Player orders resolve first, then the enemy phase.");
    expect(guide).toContain("EXECUTE TURN resolves assigned orders without requiring all squads.");
    expect(guide).not.toContain("HOLD UNASSIGNED");
    expect(guide).not.toContain("HOLD ALL");
    expect(guide).not.toContain("MOVE is queued for the selected squad");
    await act(async () => root.unmount());
  });

  afterEach(() => {
    document.body.innerHTML = "";
    storage.localStorage.clear();
  });

  it("documents the full attack operating cost in field notes", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App />));
    await act(async () =>
      (
        [...document.querySelectorAll("button")].find(
          (button) => button.textContent === "FIELD NOTES",
        ) as HTMLButtonElement
      ).click(),
    );
    expect(document.body.textContent).toContain(
      "Attacks cost 2 metal + 3 energy",
    );
    expect(document.body.textContent).toContain(
      "Defended attacks show deterministic expected losses",
    );
    await act(async () => root.unmount());
  });

  it("holds each currently unassigned living squad exactly once and preserves explicit orders", async () => {
    const campaign = createNewCampaign(42024);
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App initialGame={campaign} />));
    const moveTarget = document.querySelector(
      '[role="button"][aria-label*="Whiteplain"]',
    ) as SVGGElement;
    await act(async () =>
      moveTarget.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    const bulk = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "HOLD UNASSIGNED",
    ) as HTMLButtonElement;
    expect(document.querySelector(".unassigned-count")?.textContent).toContain(
      "4",
    );
    await act(async () => bulk.click());
    expect(document.querySelector(".unassigned-count")?.textContent).toContain(
      "0",
    );
    expect(document.querySelectorAll(".queued-order")).toHaveLength(5);
    expect(document.querySelector(".queued-orders")?.textContent).toContain(
      "squad-1 · MOVE",
    );
    expect(document.querySelector(".budget")?.textContent).toContain(
      "QUEUED 0M + 0E",
    );
    await act(async () => bulk.click());
    expect(document.querySelectorAll(".queued-order")).toHaveLength(5);
    await act(async () => root.unmount());
  });

  it("cancels a bulk hold so the squad can be refilled", async () => {
    const campaign = createNewCampaign(42024);
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App initialGame={campaign} />));
    const bulk = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "HOLD UNASSIGNED",
    ) as HTMLButtonElement;
    await act(async () => bulk.click());
    const cancel = [...document.querySelectorAll("button")].find((button) =>
      button.getAttribute("aria-label")?.includes("Cancel SENTINEL squad-1"),
    ) as HTMLButtonElement;
    await act(async () => cancel.click());
    expect(document.querySelector(".unassigned-count")?.textContent).toContain(
      "1",
    );
    expect(bulk.disabled).toBe(false);
    await act(async () => bulk.click());
    expect(document.querySelector(".unassigned-count")?.textContent).toContain(
      "0",
    );
    await act(async () => root.unmount());
  });

  it("keeps unseen defender outcomes uncertain before executing a queued assault", async () => {
    const campaign = createNewCampaign(42024);
    const initialGame = {
      ...campaign,
      squads: campaign.squads.map((squad, index) =>
        index === 0 ? { ...squad, sector: "sector-5" as const } : squad,
      ),
      enemySquads: campaign.enemySquads.map((enemy, index) =>
        index === 0
          ? { ...enemy, sector: "sector-6" as const, strength: 8 }
          : enemy,
      ),
    };
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App initialGame={initialGame} />));
    const attack = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "ATTACK",
    ) as HTMLButtonElement;
    await act(async () => attack.click());
    const target = [...document.querySelectorAll('[role="button"]')].find(
      (node) => node.getAttribute("aria-label")?.includes("attack target"),
    ) as SVGGElement;
    await act(async () => target.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(document.body.textContent).toContain("ASSAULT FORECAST");
    expect(document.body.textContent).toContain("Outcome and losses are uncertain.");
    expect(document.body.textContent).not.toContain("EXPECTED ASSAULT LOSSES");
    expect(document.body.textContent).not.toMatch(/Ward −\d+ · hostile −\d+/);
    await act(async () => root.unmount());
  });

  it("shows the deterministic debrief only after assault execution", async () => {
    const campaign = createNewCampaign(42024);
    const initialGame = {
      ...campaign,
      squads: campaign.squads.map((squad, index) =>
        index === 0 ? { ...squad, sector: "sector-5" as const } : squad,
      ),
      enemySquads: campaign.enemySquads.map((enemy, index) =>
        index === 0 ? { ...enemy, sector: "sector-6" as const, strength: 8 } : enemy,
      ),
    };
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App initialGame={initialGame} />));
    await act(async () =>
      ([...document.querySelectorAll("button")].find((button) => button.textContent === "ATTACK") as HTMLButtonElement).click(),
    );
    const target = [...document.querySelectorAll('[role="button"]')].find(
      (node) => node.getAttribute("aria-label")?.includes("attack target"),
    ) as SVGGElement;
    await act(async () => target.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(document.body.textContent).not.toContain("BATTLE REPORT");
    await act(async () => (document.querySelector(".execute") as HTMLButtonElement).click());
    expect(document.body.textContent).toContain("BATTLE REPORT");
    expect(document.body.textContent).toContain("RESOLVED");
    await act(async () => root.unmount());
  });

  it("selects a tactical target and executes the turn", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);

    await act(async () => root.render(<App />));
    const buttons = [...document.querySelectorAll("button")];
    await act(async () => (buttons[1] as HTMLButtonElement).click());
    expect(document.body.textContent).toContain("FIELD NOTES");

    await act(async () => (buttons[0] as HTMLButtonElement).click());
    const target = document.querySelector(
      '[role="button"][aria-label*="Whiteplain"]',
    ) as SVGGElement;
    await act(async () =>
      target.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(document.body.textContent).toContain("MOVE");
    await act(async () =>
      (document.querySelector(".execute") as HTMLButtonElement).click(),
    );
    expect(document.body.textContent).toContain("squad-1 move Whiteplain");
    expect(document.querySelector(".turn-readout")?.textContent).toContain(
      "02",
    );

    await act(async () => root.unmount());
  });

  it("executes multiple UI orders with one shared forecasted enemy phase", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    const issueMove = async (squadIndex: number) => {
      await act(async () =>
        (
          document.querySelectorAll(".squad-card")[
            squadIndex
          ] as HTMLButtonElement
        ).click(),
      );
      const target = document.querySelector(
        '[role="button"][aria-label*="Whiteplain"]',
      ) as SVGGElement;
      expect(target).not.toBeNull();
      await act(async () =>
        target.dispatchEvent(new MouseEvent("click", { bubbles: true })),
      );
    };

    const campaign = createNewCampaign(42024);
    const enemySectors = ["sector-2", "sector-4"] as const;
    const initialGame = {
      ...campaign,
      enemySquads: campaign.enemySquads
        .slice(0, 2)
        .map((enemy, index) => ({ ...enemy, sector: enemySectors[index] })),
    };
    const expectedTurn = resolveTurn(
      initialGame,
      initialGame.squads.slice(0, 2).map((squad, index) => ({
        squadId: squad.id,
        type: "move" as const,
        target: "sector-1" as const,
      })),
    );
    const expectedCombat = resolveCombat(
      expectedTurn.nextState,
      expectedTurn.events,
    );
    const expectedEnemy = resolveEnemyTurn(expectedCombat.nextState);
    await act(async () => root.render(<App initialGame={initialGame} />));
    await issueMove(0);
    await issueMove(1);

    const plannedOrders = [...document.querySelectorAll(".planned-order")];
    expect(plannedOrders).toHaveLength(2);
    expect(plannedOrders.map((order) => order.getAttribute("aria-label"))).toEqual([
      "PLAN · MOVE · SENTINEL M1 to Whiteplain",
      "PLAN · MOVE · RAIDER M2 to Whiteplain",
    ]);
    expect(document.querySelectorAll(".planned-marker")).toHaveLength(2);
    expect(document.querySelector('[aria-label="Planned orders legend"]')?.textContent).toContain(
      "PLAN = queued order",
    );
    expect(document.querySelector('[aria-label="Queued order squad-1 move Whiteplain"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Queued order squad-2 move Whiteplain"]')).not.toBeNull();

    await act(async () =>
      (document.querySelector(".execute") as HTMLButtonElement).click(),
    );

    const rail = [...document.querySelectorAll(".event-rail p")].map(
      (entry) => entry.textContent ?? "",
    );
    expect(
      rail.filter((message) => message.includes("squad-1 move Whiteplain")),
    ).toHaveLength(1);
    expect(
      rail.filter((message) => message.includes("squad-2 move Whiteplain")),
    ).toHaveLength(1);
    const enemyEvents = rail.filter((message) => message.includes("enemy") && !message.includes("DEBRIEF"));
    expect(enemyEvents).toEqual([]);
    expect(document.querySelector(".event-rail")?.textContent).toContain("movement withheld — Signals 0");
    expect(document.querySelector(".turn-readout strong")?.textContent).toBe(
      "02",
    );

    await act(async () => root.unmount());
  });

  it("keeps fresh-42024 Signals2 all-HOLD forecast equal to every emitted enemy event", async () => {
    let state = createNewCampaign(42024);
    state = advanceResearch(
      advanceResearch(
        { ...state, resources: { ...state.resources, intelligence: 11 } },
        "Signals",
      ),
      "Signals",
    );
    const player = resolveTurn(state, [
      { squadId: state.squads[0].id, type: "hold" },
    ]);
    const board = resolveCombat(player.nextState, player.events).nextState;
    const expected = resolveEnemyTurn(board);
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App initialGame={state} />));
    await act(async () =>
      (
        [...document.querySelectorAll("button")].find(
          (button) => button.textContent === "HOLD",
        ) as HTMLButtonElement
      ).click(),
    );
    const forecast = document.querySelector(".intel")?.textContent ?? "";
    await act(async () =>
      (document.querySelector(".execute") as HTMLButtonElement).click(),
    );
    const emitted = [...document.querySelectorAll(".event-rail p")]
      .map((entry) => entry.textContent ?? "")
      .filter((message) => message.includes("enemy-") && !message.includes("DEBRIEF"));
    expect(emitted).toHaveLength(expected.events.length);
    for (const event of expected.events) {
      const emittedEvent = emitted.find((message) =>
        message.includes(event.squadId),
      );
      expect(emittedEvent).toBeDefined();
      expect(forecast).toContain(event.squadId);
      const action =
        event.type === "move"
          ? "advances to"
          : event.type === "attack"
            ? "assaults"
            : "holds position";
      expect(forecast).toContain(action);
      expect(emittedEvent).toContain(
        event.type === "move"
          ? state.sectors.find((sector) => sector.id === event.to)?.name
          : event.type === "attack"
            ? state.sectors.find((sector) => sector.id === event.target)?.name
            : state.sectors.find((sector) => sector.id === event.from)?.name,
      );
    }
    await act(async () => root.unmount());
  });

  it("uses the selected action for neutral targets and exposes keyboard selection", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);

    await act(async () => root.render(<App />));
    const attack = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "ATTACK",
    ) as HTMLButtonElement;
    await act(async () => attack.click());
    expect(attack.getAttribute("aria-pressed")).toBe("true");

    const target = document.querySelector(
      '[role="button"][aria-label*="Whiteplain"]',
    ) as SVGGElement;
    expect(target.getAttribute("aria-label")).toContain("attack target");
    await act(async () =>
      target.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true }),
      ),
    );
    expect(
      (document.querySelector(".execute") as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(document.querySelector(".order-active")?.textContent).toBe("ATTACK");

    await act(async () => root.unmount());
  });

  it("renders the latest typed battle report between orders and events, retains it, and resets it", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    const clickSector = async (name: string) => {
      const sector = document.querySelector(
        `[role="button"][aria-label*="${name}"]`,
      ) as SVGGElement;
      expect(sector).not.toBeNull();
      await act(async () =>
        sector.dispatchEvent(new MouseEvent("click", { bubbles: true })),
      );
      await act(async () =>
        (document.querySelector(".execute") as HTMLButtonElement).click(),
      );
    };

    await act(async () => root.render(<App />));
    const initialSidebar = [
      ...document.querySelector(".side-panel")!.children,
    ].map((node) => node.className);
    expect(initialSidebar).toEqual([
      "card squad-panel",
      "card orders",
      "card event-rail",
    ]);
    expect(document.querySelector(".seed-readout")?.textContent).toBe(
      "SEED 42024",
    );
    expect(document.querySelector(".turn-readout")?.textContent).toContain(
      "NEW CAMPAIGN",
    );

    await clickSector("Whiteplain");
    await clickSector("Glassway");
    await act(async () =>
      (
        [...document.querySelectorAll("button")].find(
          (button) => button.textContent === "ATTACK",
        ) as HTMLButtonElement
      ).click(),
    );
    await clickSector("Ashenfall");

    expect(document.querySelector(".event-rail")?.textContent).toContain(
      "squad-1 attack Ashenfall",
    );
    const report = document.querySelector(".reports");
    expect(report?.textContent).toContain("BATTLE REPORT");
    expect(report?.textContent).toContain("Ashenfall");
    expect(report?.textContent).toMatch(/ATTACKER/);
    expect(report?.textContent).toMatch(/DEFENDER/);
    expect(report?.textContent).toMatch(
      /Terrain .* ×.* · fatigue −.* · variance/,
    );
    expect(report?.textContent).toContain("casualty entries");
    expect(report?.textContent).toMatch(/retreat|Retreat/);
    expect(report?.textContent).toMatch(/Captured|Not captured/);
    expect(report?.parentElement?.className).toBe("side-panel");
    expect(report?.nextElementSibling?.classList.contains("squad-panel")).toBe(
      true,
    );
    expect(
      report?.nextElementSibling?.nextElementSibling?.classList.contains(
        "orders",
      ),
    ).toBe(true);
    expect(
      report?.nextElementSibling?.nextElementSibling?.nextElementSibling?.classList.contains(
        "event-rail",
      ),
    ).toBe(true);
    expect(
      [...report!.parentElement!.children].map((node) => node.className),
    ).toEqual([
      "reports card",
      "card squad-panel",
      "card orders",
      "card event-rail",
    ]);

    const latestReport = report?.textContent;
    await act(async () =>
      (
        [...document.querySelectorAll("button")].find(
          (button) => button.textContent === "HOLD",
        ) as HTMLButtonElement
      ).click(),
    );
    await act(async () =>
      (document.querySelector(".execute") as HTMLButtonElement).click(),
    );
    expect(document.querySelector(".reports")?.textContent).toContain(
      "BATTLE REPORT",
    );

    await act(async () =>
      (
        [...document.querySelectorAll("button")].find(
          (button) => button.textContent?.startsWith("NEW CAMPAIGN"),
        ) as HTMLButtonElement
      ).click(),
    );
    expect(document.querySelector(".reports")).toBeNull();
    expect(document.querySelector(".event-rail")?.textContent).toContain(
      "Awaiting first orders...",
    );

    await act(async () => root.unmount());
  });
  it("preserves the original turn of player, enemy, and battle events across turns", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    const entries = () =>
      [...document.querySelectorAll(".event-rail p")].map((entry) => ({
        turn: entry.querySelector("span")?.textContent,
        message: entry.lastChild?.textContent,
      }));
    const executeTarget = async (name: string) => {
      const target = document.querySelector(
        `[role="button"][aria-label*="${name}"]`,
      ) as SVGGElement;
      await act(async () =>
        target.dispatchEvent(new MouseEvent("click", { bubbles: true })),
      );
      await act(async () =>
        (document.querySelector(".execute") as HTMLButtonElement).click(),
      );
    };

    await act(async () => root.render(<App />));
    await executeTarget("Whiteplain");
    const firstTurn = entries();
    expect(firstTurn.length).toBeGreaterThanOrEqual(2);
    expect(firstTurn.every((entry) => entry.turn === "01")).toBe(true);
    expect(firstTurn.some((entry) => entry.message?.startsWith("enemy-"))).toBe(
      false,
    );
    expect(firstTurn).toContainEqual({
      turn: "01",
      message: "squad-1 move Whiteplain",
    });

    await executeTarget("Glassway");
    expect(
      entries()
        .slice(0, 2)
        .every((entry) => entry.turn === "02"),
    ).toBe(true);
    expect(entries().filter((entry) => entry.turn === "01")).toEqual(firstTurn);
    await act(async () =>
      (
        [...document.querySelectorAll("button")].find(
          (button) => button.textContent === "ATTACK",
        ) as HTMLButtonElement
      ).click(),
    );
    await executeTarget("Ashenfall");
    const battleTurn = entries();
    expect(battleTurn[0].message).toMatch(/^Ashenfall .* casualty entries$/);
    expect(battleTurn.slice(0, Math.min(3, battleTurn.length)).every((entry) => entry.turn === "03")).toBe(
      true,
    );
    const retainedFirstTurnEnemies = battleTurn.filter(
      (entry) => entry.turn === "01" && entry.message?.startsWith("enemy-"),
    );
    expect(retainedFirstTurnEnemies).toEqual([]);

    await act(async () =>
      (
        [...document.querySelectorAll("button")].find(
          (button) => button.textContent === "HOLD",
        ) as HTMLButtonElement
      ).click(),
    );
    await act(async () =>
      (document.querySelector(".execute") as HTMLButtonElement).click(),
    );
    expect(
      entries()
        .slice(0, 2)
        .every((entry) => entry.turn === "04"),
    ).toBe(true);
    const afterEnemyPhase = entries();
    expect(
      afterEnemyPhase.some((entry) => entry.message === battleTurn[0].message),
    ).toBe(true);
    expect(
      afterEnemyPhase.filter((entry) => entry.turn === "04").length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      entries().some(
        (entry) => entry.turn === "04" && entry.message?.startsWith("enemy-"),
      ),
    ).toBe(false);
    expect(document.querySelector(".turn-readout strong")?.textContent).toBe(
      "05",
    );

    await act(async () => root.unmount());
  });

  it("keeps commands bound to a displayed live squad selection", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App />));
    const squadCards = [...document.querySelectorAll(".squad-card")];
    expect(squadCards).toHaveLength(5);
    expect(document.querySelector(".selection-note")?.textContent).toContain(
      "Frostgate",
    );
    await act(async () => root.unmount());
  });

  it("renders the no-survivors state for a zero-player-squad campaign", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    const campaign = createNewCampaign(42024);
    await act(async () =>
      root.render(<App initialGame={{ ...campaign, squads: [] }} />),
    );
    expect(document.body.textContent).toContain("NO SURVIVORS");
    expect(document.body.textContent).toContain("no active squads");
    await act(async () => root.unmount());
  });

  it("selects, queues, resolves, and reloads a named-sector turn with its debrief and real tradeoffs", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    const campaign = createNewCampaign(42024);
    const initialGame = { ...campaign, squads: campaign.squads.map((squad, index) => index === 0 ? { ...squad, sector: "sector-5" as const, strength: 1, fatigue: 3 } : squad) };
    writeSave({ version: SAVE_VERSION, game: initialGame, events: [], reports: [] });
    await act(async () => root.render(<App />));
    await act(async () => ([...document.querySelectorAll("button")].find((button) => button.textContent?.startsWith("CONTINUE")) as HTMLButtonElement).click());
    const objectives = document.querySelector(".campaign-objectives") as HTMLElement;
    const debriefBefore = document.querySelector('[aria-label="Last turn debrief"]') as HTMLElement;
    const income = document.querySelector(".income") as HTMLElement;
    expect(objectives.compareDocumentPosition(debriefBefore) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(debriefBefore.compareDocumentPosition(income) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const attackPreviewBeforeQueue = document.querySelector('[aria-label="Attack preview"]')?.textContent ?? "";
    expect(attackPreviewBeforeQueue).toMatch(/STR 1, FTG 3/);
    expect(attackPreviewBeforeQueue).toMatch(/HOLD is free.*FTG to 2/);
    expect(attackPreviewBeforeQueue).toMatch(/RECOVER (costs .*STR to .*FTG to|is unavailable while unsupplied)/);
    expect(attackPreviewBeforeQueue).toContain("available only against a legal target");
    await act(async () => ([...document.querySelectorAll("button")].find((button) => button.textContent === "ATTACK") as HTMLButtonElement).click());
    const target = document.querySelector('[role="button"][aria-label*="Ashenfall"]') as SVGGElement;
    expect(target.getAttribute("aria-label")).toContain("attack target");
    await act(async () => target.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(document.querySelector(".queued-orders")?.textContent).toContain("ATTACK → Ashenfall");
    expect(document.querySelector(".budget")?.textContent).toContain("QUEUED 2M + 3E");
    expect(document.querySelector('[aria-label="Attack preview"]')?.textContent).toContain("costs 2 metal + 3 energy");
    await act(async () => (document.querySelector(".execute") as HTMLButtonElement).click());
    const rail = document.querySelector(".event-rail")?.textContent ?? "";
    expect(rail).toContain("TURN 1 DEBRIEF");
    expect(rail).toContain("Ashenfall");
    expect(rail).not.toMatch(/sector-\d+/);
    expect(rail).toMatch(/ATTACK \(cost 2 metal \+ 3 energy\)/);
    const debrief = document.querySelector('[aria-label="Last turn debrief"]')?.textContent ?? "";
    expect(debrief).toContain("WHAT CHANGED / WHY");
    expect(debrief).toContain("Ashenfall");
    expect(debrief).toContain("RESOURCES Δ");
    expect(debrief).toContain("PLAYER RESULT:");
    expect(debrief).toContain("ENEMY PHASE OBSERVED:");
    expect(debrief).toContain("NEXT:");
    expect(document.querySelector('[aria-label="Last turn debrief"]')).not.toBe(document.querySelector(".event-rail"));
    expect(debrief).not.toContain("RELAY CONTROL:");
    expect(debrief).toContain("UNASSIGNED FATIGUE:");
    expect(debrief).toContain("SQUAD LOSSES:");
    expect(debrief).toMatch(/WHY: .*STR 1, FTG 3.*ATTACK risks losing this squad.*HOLD.*RECOVER/);
    expect(document.querySelector(".debrief-what-changed")?.textContent).toContain("WHAT CHANGED:");
    expect(document.querySelector(".debrief-player-result")?.textContent).toContain("PLAYER RESULT:");
    expect(document.querySelector(".debrief-next")?.textContent).toContain("NEXT:");
    const summary = document.querySelector(".debrief-summary")?.textContent ?? "";
    expect(summary).toContain("PLAYER RESULT:");
    expect(document.querySelector(".debrief-what-changed")?.textContent).not.toContain("HOLD");
    expect(document.querySelector(".debrief-summary")?.firstElementChild?.textContent).toContain("PLAYER RESULT:");
    expect(debrief).toContain("connected");
    expect((document.querySelector('[aria-label="Last turn debrief"]') as HTMLElement).compareDocumentPosition(document.querySelector(".map-panel") as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((document.querySelector('[aria-label="Last turn debrief"]') as HTMLElement).compareDocumentPosition(document.querySelector(".orders") as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const debriefElement = document.querySelector('[aria-label="Last turn debrief"]') as HTMLElement;
    const battleLayout = document.querySelector(".battle-layout") as HTMLElement;
    expect(debriefElement.parentElement).toBe(battleLayout.parentElement);
    expect(debriefElement.compareDocumentPosition(battleLayout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect([...battleLayout.children].map((child) => child.className)).toEqual(["map-panel card", "side-panel"]);
    expect(document.querySelector('[role="status"]')?.textContent).toContain("saved");
    await act(async () => root.unmount());
    document.body.innerHTML = '<div id="root"></div>';
    const reloaded = createRoot(document.getElementById("root")!);
    await act(async () => reloaded.render(<App />));
    const continueButton = [...document.querySelectorAll("button")].find((button) => button.textContent?.startsWith("CONTINUE"));
    if (continueButton) await act(async () => (continueButton as HTMLButtonElement).click());
    expect(document.querySelector(".turn-readout strong")?.textContent).toBe("02");
    expect(document.querySelector(".event-rail")?.textContent).toContain("TURN 1 DEBRIEF");
    expect(document.querySelector(".event-rail")?.textContent).toContain("Ashenfall");
    await act(async () => reloaded.unmount());
  });

  it("makes terminal campaigns read-only and offers restart controls", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    const campaign = createNewCampaign(42024);
    await act(async () => root.render(<App initialGame={{ ...campaign, turn: 19, terminal: "defeat", terminalReason: "Turn 18 reached without victory." }} />));
    expect(document.querySelector(".terminal")?.textContent).toContain("TURN 18 — DEFEAT");
    expect(document.querySelector(".terminal")?.textContent).toContain("Turn 18 reached without victory.");
    expect([...document.querySelectorAll(".order-buttons button")].every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect((document.querySelector(".execute") as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector(".queued-orders")?.textContent).toContain("No orders can be queued");
    await act(async () => root.unmount());
  });

  it("keeps an empty queue explicit and disables execute", async () => {
    const root = await renderApp(createNewCampaign(42024));
    expect(document.querySelector(".queued-orders")?.textContent).toContain("No orders queued");
    expect((document.querySelector(".execute") as HTMLButtonElement).disabled).toBe(true);
    const guide = document.querySelector('[aria-label="Turn guide"]')?.textContent ?? "";
    expect(guide).not.toContain("EXECUTE");
    expect(guide).toContain("Queue orders for your squads.");
    await act(async () => root.unmount());
  });

  it("does not show a highlighted-target prompt after the campaign ends", async () => {
    const root = await renderApp({ ...createNewCampaign(42024), terminal: "victory", terminalReason: "secured" });
    const guide = document.querySelector('[aria-label="Turn guide"]')?.textContent ?? "";
    expect(guide).toContain("Terminal state: VICTORY");
    expect(guide).not.toContain("highlighted target");
    await act(async () => root.unmount());
  });

  it("gives MOVE a usable fallback when no target is reachable", async () => {
    const campaign = createNewCampaign(42024);
    const root = await renderApp({
      ...campaign,
      sectors: campaign.sectors.map((sector) => sector.id === "sector-6" ? { ...sector, links: [] } : sector),
      squads: campaign.squads.map((unit, index) => index === 0 ? { ...unit, sector: "sector-6" as const } : { ...unit, strength: 0 }),
    });
    const guide = document.querySelector('[aria-label="Turn guide"]')?.textContent ?? "";
    expect(guide).toContain("no unoccupied friendly destination is reachable; use HOLD or change squad");
    expect(guide).not.toContain("use HOLD or RECOVER");
    await act(async () => root.unmount());
  });

  it("omits owned relays from the required relay prompt", async () => {
    const campaign = createNewCampaign(42024);
    const root = await renderApp({ ...campaign, objectives: campaign.objectives.map((objective) => ({ ...objective, controlled: true })) });
    const guide = document.querySelector('[aria-label="Turn guide"]')?.textContent ?? "";
    expect(guide).toContain("Remaining relays: none");
    expect(guide).not.toContain("Remaining relays: Northstar");
    await act(async () => root.unmount());
  });

  it("does not offer impossible next choices when the last squad is dead", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    const campaign = createNewCampaign(42024);
    const dead = { ...campaign, squads: campaign.squads.map((squad) => ({ ...squad, strength: 0 })) };
    await act(async () => root.render(<App initialGame={dead} />));
    expect(document.querySelector('[aria-label="Last turn debrief"]')?.textContent).toContain("Execute a turn");
    expect(document.querySelector(".queued-orders")?.textContent).toContain("No orders queued");
    expect((document.querySelector(".execute") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => root.unmount());
  });

  it("derives relay flips and dead-squad deltas from actual resolver snapshots", () => {
    let relayFlip: { before: string; after: string } | undefined;
    let deadSquad: { before: number; after: number } | undefined;
    for (let seed = 1; seed < 5000 && (!relayFlip || !deadSquad); seed += 1) {
      const campaign = createNewCampaign(seed);
      const squad = campaign.squads[0];
      if (!squad) continue;
      const currentSector = campaign.sectors.find((sector) => sector.id === squad.sector);
      const target = campaign.sectors.find((sector) => currentSector?.links.includes(sector.id));
      if (!target) continue;
      const before = {
        ...campaign,
        enemySquads: [],
        objectives: campaign.objectives.map((item, index) => index === 0 ? { ...item, sector: target.id, controlled: false } : item),
        sectors: campaign.sectors.map((sector) => sector.id === target.id ? { ...sector, owner: "enemy" as const } : sector),
        squads: campaign.squads.map((item) => item.id === squad.id ? { ...item, strength: 1, fatigue: 3 } : item),
      };
      const turn = resolveTurn(before, [{ squadId: squad.id, type: "attack", target: target.id }]);
      const combat = resolveCombat(turn.nextState, turn.events);
      const after = resolveEnemyTurn(combat.nextState).nextState;
      const beforeSector = before.sectors.find((sector) => sector.id === target.id);
      const afterSector = after.sectors.find((sector) => sector.id === target.id);
      if (beforeSector && afterSector && beforeSector.owner !== afterSector.owner) relayFlip = { before: beforeSector.owner, after: afterSector.owner };
      const beforeSquad = before.squads.find((item) => item.id === squad.id);
      const afterSquad = after.squads.find((item) => item.id === squad.id);
      if (beforeSquad && afterSquad && afterSquad.strength <= 0) deadSquad = { before: beforeSquad.strength, after: afterSquad.strength };
      if (!deadSquad && campaign.enemySquads[0]) {
        const defended = { ...before, enemySquads: [{ ...campaign.enemySquads[0], sector: target.id, strength: 10 }] };
        const defendedTurn = resolveTurn(defended, [{ squadId: squad.id, type: "attack", target: target.id }]);
        const defendedCombat = resolveCombat(defendedTurn.nextState, defendedTurn.events);
        const defendedAfter = resolveEnemyTurn(defendedCombat.nextState).nextState;
        const deadAfter = defendedAfter.squads.find((item) => item.id === squad.id);
        if (!deadAfter) deadSquad = { before: 1, after: 0 };
      }
    }
    expect(relayFlip).toEqual({ before: "enemy", after: "player" });
    expect(deadSquad?.before).toBe(1);
    expect(deadSquad?.after).toBe(0);
  });

  it("keeps reachable Signals2 forecast aligned with the actual HOLD event", async () => {
    let state = createNewCampaign(2244426087);
    const hold = () => {
      const turn = resolveTurn(
        state,
        state.squads.map((squad) => ({
          squadId: squad.id,
          type: "hold" as const,
        })),
      );
      const combat = resolveCombat(turn.nextState, turn.events);
      state = resolveEnemyTurn(combat.nextState).nextState;
    };
    for (let i = 0; i < 6; i += 1) hold();
    state = advanceResearch(state, "Signals");
    for (let i = 0; i < 7; i += 1) hold();
    state = advanceResearch(state, "Signals");
    const projectedTurn = resolveTurn(
      state,
      state.squads.map((squad) => ({
        squadId: squad.id,
        type: "hold" as const,
      })),
    );
    const projectedBoard = resolveCombat(
      projectedTurn.nextState,
      projectedTurn.events,
    ).nextState;
    const expected = decideEnemyIntent(projectedBoard);
    const expectedSector = expected?.target ?? expected?.to;
    const expectedName = projectedBoard.sectors.find(
      (sector) => sector.id === expectedSector,
    )?.name;
    const projected = resolveEnemyTurn(projectedBoard).nextState;
    const nextExpected = decideEnemyIntent(projected, projected.turn + 1);
    const nextExpectedSector = nextExpected?.target ?? nextExpected?.to;
    const nextExpectedName = projected.sectors.find(
      (sector) => sector.id === nextExpectedSector,
    )?.name;
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App initialGame={state} />));
    const forecastText = document.querySelector(".intel")?.textContent ?? "";
    expect(forecastText).toContain("ROUTE INTENTS:");
    expect(forecastText).toMatch(/(?:ROUTE INTENTS:|garrison at)/);
    expect(forecastText).not.toContain("undefined");
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const before = document.querySelector(".intel")?.textContent ?? "";
      expect(before).toContain("ROUTE INTENTS:");
      await act(async () =>
        (
          [...document.querySelectorAll("button")].find(
            (button) => button.textContent === "HOLD",
          ) as HTMLButtonElement
        ).click(),
      );
      await act(async () =>
        (document.querySelector(".execute") as HTMLButtonElement).click(),
      );
      const eventText =
        document.querySelector(".event-rail")?.textContent ?? "";
      const actor = eventText.match(/enemy-[0-9]+/)?.[0];
      const action = eventText.match(/(advances|assaults|holds)/)?.[1];
      const targetId = eventText.match(/sector-[0-9]+/)?.[0];
      const targetName =
        state.sectors
          .map((sector) => sector.name)
          .find((name) => eventText.includes(name)) ??
        state.sectors.find((sector) => sector.id === targetId)?.name;
      expect(actor).toBeDefined();
      expect(action).toBeDefined();
      expect(eventText).toMatch(
        /sector-[0-9]+|Northstar|Cairnwatch|Whiteplain|Glassway|Ashenfall|Vesper|Dawnscar|Ironhollow|Lastlight|Bluevault|Frostgate|Rimefield|Hearthmere|Stonewatch/,
      );
      expect(before).toContain(actor!);
      expect(before).toContain(
        action === "advances"
          ? "advances to"
          : action === "assaults"
            ? "assaults"
            : "holds position",
      );
      const routeSuffix =
        action === "advances"
          ? before.match(
              new RegExp(`${actor}[^\n]*advances to ([A-Za-z]+)`, "i"),
            )?.[1]
          : action === "assaults"
            ? before.match(
                new RegExp(`${actor}[^\n]*assaults ([A-Za-z]+)`, "i"),
              )?.[1]
            : undefined;
      if (action === "advances" || action === "assaults") {
        expect(routeSuffix).toBeDefined();
        expect(eventText).toContain(routeSuffix!);
      }
    }
    expect(document.querySelector(".intel")?.textContent).toContain(
      "ROUTE INTENTS:",
    );
    await act(async () => root.unmount());
  });

  it("selects research, charges its real cost, and shows all two-level controls", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App />));
    const logistics = [...document.querySelectorAll(".research button")].find(
      (button) => button.textContent?.includes("Logistics"),
    ) as HTMLButtonElement;
    await act(async () => logistics.click());
    expect(logistics.textContent).toContain("1/2");
    expect(document.body.textContent).toContain("LVL 2");
    expect(document.querySelectorAll(".research button")).toHaveLength(3);
    await act(async () => root.unmount());
  });

  it("blocks terminal orders and permits restart", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    const terminal = terminalState({
      ...createNewCampaign(7),
      squads: [],
      terminal: "active",
    });
    await act(async () => root.render(<App initialGame={terminal} />));
    expect(document.body.textContent).toContain("NO SURVIVORS");
    await act(async () =>
      (document.querySelector(".primary") as HTMLButtonElement).click(),
    );
    expect(document.body.textContent).toContain("SEED 7");
    await act(async () => root.unmount());
  });

  it("selects research, spends its real cost, and shows HQ-connected income sources", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App />));
    expect(document.querySelector(".income")?.textContent).toContain(
      "Frostgate: HQ CONNECTED · +2M +2E +1I",
    );
    expect(document.querySelector(".income")?.textContent).toContain(
      "TOTAL +2M +2E +1I / TURN",
    );
    const logistics = [...document.querySelectorAll(".research button")].find(
      (button) => button.textContent?.includes("Logistics"),
    ) as HTMLButtonElement;
    expect(logistics.textContent).toContain("LVL 1");
    await act(async () => logistics.click());
    expect(logistics.textContent).toContain("1/2");
    expect(logistics.textContent).toContain("LVL 2");
    await act(async () => root.unmount());
  });

  it("buys Signals twice from earned income and renders paid route strings before the next event", async () => {
    let earned = createNewCampaign(42024);
    for (let i = 0; i < 6; i += 1) {
      const turn = resolveTurn(
        earned,
        earned.squads.map((squad) => ({
          squadId: squad.id,
          type: "hold" as const,
        })),
      );
      earned = resolveEnemyTurn(
        resolveCombat(turn.nextState, turn.events).nextState,
      ).nextState;
    }
    expect(earned.resources.intelligence).toBeGreaterThanOrEqual(11);
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App initialGame={earned} />));
    const signals = () =>
      [...document.querySelectorAll(".research button")].find((button) =>
        button.textContent?.includes("Signals"),
      ) as HTMLButtonElement;
    await act(async () => signals().click());
    await act(async () => signals().click());
    const rendered = document.querySelector(".intel")?.textContent ?? "";
    expect(rendered).toContain("ROUTE INTENTS:");
    expect(rendered).toMatch(/advances to|assaults|holds position|waits/);
    const tierTwo = advanceResearch(
      advanceResearch(earned, "Signals"),
      "Signals",
    );
    const forecast = decideEnemyIntent(tierTwo);
    const turn = resolveTurn(
      tierTwo,
      tierTwo.squads.map((squad) => ({
        squadId: squad.id,
        type: "hold" as const,
      })),
    );
    const combat = resolveCombat(turn.nextState, turn.events);
    const actual = resolveEnemyTurn(combat.nextState).events[0];
    expect(actual?.squadId).toBe(forecast?.squadId);
    expect(actual?.type).toBe(
      forecast?.kind === "wait" ? "hold" : forecast?.kind,
    );
    const actualDestination = actual?.target ?? actual?.to;
    const actualName = tierTwo.sectors.find(
      (sector) => sector.id === actualDestination,
    )?.name;
    expect(actualName).toBeTruthy();
    expect(rendered).toContain(actualName!);
    await act(async () => root.unmount());
  });

  it("renders Signals identities, classes, sector names, and tier2 route candidates", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    const seedGame = createNewCampaign(42024);
    const tier1 = advanceResearch(
      { ...seedGame, resources: { ...seedGame.resources, intelligence: 11 } },
      "Signals",
    );
    await act(async () => root.render(<App initialGame={tier1} />));
    const intel = document.querySelector(".intel")!;
    const enemy = tier1.enemySquads[0];
    expect(intel.textContent).toContain(enemy.id);
    expect(intel.textContent).toContain(enemy.class.toUpperCase());
    expect(intel.textContent).toContain(
      tier1.sectors.find((sector) => sector.id === enemy.sector)!.name,
    );
    const tier2 = advanceResearch(tier1, "Signals");
    expect(tier2.researchLevels.Signals).toBe(2);
    expect(tier2.scoutedEnemyRoutes.length).toBeGreaterThan(0);
    await act(async () => root.unmount());
    const tier2Root = createRoot(document.getElementById("root")!);
    await act(async () => tier2Root.render(<App initialGame={tier2} />));
    expect(document.querySelector(".intel")?.textContent).toContain(
      "ROUTE INTENTS:",
    );
    expect(document.querySelector(".intel")?.textContent).toContain(
      "advances to",
    );
    expect(document.querySelector(".research-effects")?.textContent).toContain(
      "routes",
    );
    expect(
      document.querySelectorAll(".research button")[2].textContent,
    ).toContain("COMPLETE");
    expect(
      document.querySelectorAll(".research button")[2].textContent,
    ).not.toMatch(/LVL 3|undefined|\{"/);
    expect(document.querySelectorAll(".research button")[2]).toHaveProperty(
      "disabled",
      true,
    );
    await act(async () => tier2Root.unmount());
  });

  it("renders readable next-tier costs and exact effects for every research branch", async () => {
    const states = [
      createNewCampaign(42024),
      {
        ...createNewCampaign(42024),
        researchLevels: { Logistics: 1, Warfare: 1, Signals: 1 },
      },
      {
        ...createNewCampaign(42024),
        researchLevels: { Logistics: 2, Warfare: 2, Signals: 2 },
      },
    ];
    for (const state of states) {
      document.body.innerHTML = '<div id="root"></div>';
      const root = createRoot(document.getElementById("root")!);
      await act(async () => root.render(<App initialGame={state} />));
      const text = document.querySelector(".research")?.textContent ?? "";
      expect(text).not.toContain("JSON");
      expect(text).not.toContain("undefined");
      if (state.researchLevels.Logistics < 2) expect(text).toContain("metal");
      if (state.researchLevels.Warfare < 2) expect(text).toContain("energy");
      if (state.researchLevels.Signals < 2)
        expect(text).toContain("intelligence");
      if (state.researchLevels.Logistics === 0)
        expect(text).toContain("Strength/supply cap 12 · recovery +1");
      if (state.researchLevels.Logistics === 1)
        expect(text).toContain("Strength/supply cap 14 · recovery +2");
      if (state.researchLevels.Warfare === 0)
        expect(text).toContain("Counter matchups +5% · fortification +5%");
      if (state.researchLevels.Warfare === 1)
        expect(text).toContain("Counter matchups +10% · fortification +10%");
      if (state.researchLevels.Signals === 0)
        expect(text).toContain("identities and sectors");
      if (state.researchLevels.Signals === 1)
        expect(text).toContain("identities, sectors, and routes");
      if (state.researchLevels.Logistics === 0)
        expect(text).toContain("8 metal + 1 energy");
      if (state.researchLevels.Logistics === 1)
        expect(text).toContain("12 metal + 2 energy");
      if (state.researchLevels.Warfare === 0)
        expect(text).toContain("1 metal + 8 energy");
      if (state.researchLevels.Warfare === 1)
        expect(text).toContain("2 metal + 12 energy");
      if (state.researchLevels.Signals === 0)
        expect(text).toContain("2 metal + 4 intelligence");
      if (state.researchLevels.Signals === 1)
        expect(text).toContain("3 metal + 7 intelligence");
      if (state.researchLevels.Logistics === 2) {
        expect(text).toContain("COMPLETE");
        for (const branch of ["Logistics", "Warfare", "Signals"]) {
          const button = [
            ...document.querySelectorAll(".research button"),
          ].find((item) => item.textContent?.startsWith(branch))!;
          expect(button.textContent).not.toMatch(/COST|NEXT|LVL3/);
        }
      }
      await act(async () => root.unmount());
    }
  });

  it("blocks terminal orders and offers a restart", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    const campaign = createNewCampaign(42);
    await act(async () =>
      root.render(
        <App
          initialGame={{
            ...campaign,
            turn: 19,
            terminal: "defeat",
            terminalReason: "Turn 18 reached without victory.",
          }}
        />,
      ),
    );
    expect(document.querySelector(".terminal")?.textContent).toContain(
      "TURN 18 — DEFEAT",
    );
    expect(
      (document.querySelector(".execute") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      [...document.querySelectorAll(".research button")].every(
        (button) => (button as HTMLButtonElement).disabled,
      ),
    ).toBe(true);
    await act(async () =>
      (
        [...document.querySelectorAll(".terminal button")].find((button) =>
          button.textContent?.startsWith("RESET SAME SEED"),
        ) as HTMLButtonElement
      ).click(),
    );
    expect(document.querySelector(".terminal")).toBeNull();
    expect(document.querySelector(".turn-readout strong")?.textContent).toBe(
      "01",
    );
    await act(async () => root.unmount());
  });

  it("shows queued costs, recomputes replacement, and blocks an unaffordable plan", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App />));
    const squads = () =>
      [...document.querySelectorAll(".squad-card")] as HTMLButtonElement[];
    const recover = async (index: number) => {
      await act(async () => squads()[index].click());
      await act(async () =>
        (
          document.querySelector(
            ".order-buttons button:nth-child(2)",
          ) as HTMLButtonElement
        ).click(),
      );
    };
    await recover(0);
    expect(document.querySelector(".budget")?.textContent).toContain(
      "QUEUED 6M + 2E · REMAINING 14M + 18E",
    );
    expect(
      (document.querySelector(".execute") as HTMLButtonElement).disabled,
    ).toBe(false);
    await act(async () => squads()[0].click());
    await act(async () =>
      (
        document.querySelector(
          ".order-buttons button:first-child",
        ) as HTMLButtonElement
      ).click(),
    );
    expect(document.querySelector(".budget")?.textContent).toContain(
      "QUEUED 0M + 0E · REMAINING 20M + 20E",
    );
    await recover(1);
    await recover(2);
    await recover(3);
    const logistics = [...document.querySelectorAll(".research button")].find(
      (button) => button.textContent?.includes("Logistics"),
    ) as HTMLButtonElement;
    await act(async () => logistics.click());
    expect(document.querySelector(".budget")?.textContent).toContain(
      "REMAINING -6M + 13E",
    );
    expect(document.querySelector(".budget")?.textContent).toContain(
      "SHORT 6M",
    );
    expect(
      (document.querySelector(".execute") as HTMLButtonElement).disabled,
    ).toBe(true);
    await act(async () => root.unmount());
  });

  it("displays exact affordable attack spending and clears the queued budget after execution", async () => {
    const campaign = createNewCampaign(42024);
    const initialGame = {
      ...campaign,
      resources: { ...campaign.resources, metal: 2, energy: 3 },
    };
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App initialGame={initialGame} />));
    await act(async () =>
      (
        document.querySelector(
          ".order-buttons button:nth-child(4)",
        ) as HTMLButtonElement
      ).click(),
    );
    await act(async () =>
      (
        document.querySelector(
          '[role="button"][aria-label*="Whiteplain"]',
        ) as SVGGElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(document.querySelector(".budget")?.textContent).toContain(
      "QUEUED 2M + 3E",
    );
    expect(document.querySelector(".budget")?.textContent).toContain(
      "REMAINING 0M + 0E BEFORE INCOME",
    );
    await act(async () =>
      (document.querySelector(".execute") as HTMLButtonElement).click(),
    );
    expect(document.querySelector(".budget")?.textContent).toContain(
      "REMAINING 2M + 2E",
    );
    await act(async () => root.unmount());
  });

  it("shows named queued targets and cancels only the selected order", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App />));
    const squads = () =>
      [...document.querySelectorAll(".squad-card")] as HTMLButtonElement[];
    await act(async () => squads()[0].click());
    await act(async () =>
      (
        document.querySelector(
          ".order-buttons button:nth-child(2)",
        ) as HTMLButtonElement
      ).click(),
    );
    await act(async () => squads()[1].click());
    await act(async () =>
      (
        document.querySelector(
          ".order-buttons button:nth-child(2)",
        ) as HTMLButtonElement
      ).click(),
    );
    expect(document.querySelectorAll(".queued-order")).toHaveLength(2);
    expect(document.querySelector(".queued-orders")?.textContent).toContain(
      "RECOVER",
    );
    await act(async () =>
      (
        document.querySelector(".queued-order button") as HTMLButtonElement
      ).click(),
    );
    expect(document.querySelectorAll(".queued-order")).toHaveLength(1);
    expect(document.querySelector(".queued-orders")?.textContent).toContain(
      "RECOVER",
    );
    await act(async () => root.unmount());
  });



describe("Editable turn plan", () => {
  const queue = () => document.querySelector('[aria-label="Queued orders"]')!;
  const rows = () => [...queue().querySelectorAll("li")];
  const execute = () => document.querySelector(".execute") as HTMLButtonElement;
  const budget = () => document.querySelector(".budget")!.textContent;
  const click = async (element: Element) => {
    await act(async () => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  };
  const action = (name: string) =>
    [...document.querySelectorAll(".order-buttons button")].find(
      (button) => button.textContent === name,
    )!;
  const select = async (index: number) =>
    click(document.querySelectorAll(".squad-card")[index]);
  const target = async (name: string) =>
    click(document.querySelector(`[role="button"][aria-label^="${name},"]`)!);
  const cancel = async (id: string) =>
    click(
      queue().querySelector(`[aria-label^="Cancel "][aria-label*="${id}"]`)!,
    );
  const mount = async (initialGame?: ReturnType<typeof createNewCampaign>) => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App initialGame={initialGame} />));
    const continueButton = [...document.querySelectorAll("button")].find((button) => button.textContent?.startsWith("CONTINUE"));
    if (continueButton) await act(async () => (continueButton as HTMLButtonElement).click());
    return root;
  };

  const queueMoves = async (count: number, destination = "Whiteplain") => {
    for (let index = 0; index < count; index += 1) {
      await select(index);
      await click(action("MOVE"));
      await target(destination);
    }
  };

  it("warns when every living HQ garrison squad is queued to MOVE away", async () => {
    const root = await mount(createNewCampaign(42024));
    await queueMoves(5);
    expect(document.querySelector(".hq-garrison-warning")?.textContent).toContain("Frostgate: this plan leaves it undefended");
    expect(document.querySelector(".hq-garrison-warning")?.textContent).toContain("HQ loss ends the campaign");
    expect(document.querySelector(".hq-garrison-warning")?.textContent).toContain("Retain a defender");
    await act(async () => root.unmount());
  });

  it("suppresses the warning when a garrison defender is retained", async () => {
    const root = await mount(createNewCampaign(42024));
    await queueMoves(4);
    expect(document.querySelector(".hq-garrison-warning")).toBeNull();
    await act(async () => root.unmount());
  });

  it("suppresses the warning when a departure is cancelled or replaced", async () => {
    const root = await mount(createNewCampaign(42024));
    await queueMoves(5);
    expect(document.querySelector(".hq-garrison-warning")).toBeTruthy();
    await cancel("squad-4");
    expect(document.querySelector(".hq-garrison-warning")).toBeNull();
    await select(3);
    await click(action("RECOVER"));
    expect(document.querySelector(".hq-garrison-warning")).toBeNull();
    await act(async () => root.unmount());
  });

  it("suppresses the warning when a living squad is queued to MOVE into HQ", async () => {
    const campaign = createNewCampaign(42024);
    const state = { ...campaign, squads: campaign.squads.map((squad, index) => index === 3 ? { ...squad, sector: "sector-1" as const } : squad) };
    const root = await mount(state);
    await queueMoves(3);
    await select(4);
    await click(action("MOVE"));
    await target("Whiteplain");
    expect(document.querySelector(".hq-garrison-warning")).toBeTruthy();
    await select(3);
    await click(action("MOVE"));
    await target("Frostgate");
    expect(document.querySelector(".hq-garrison-warning")).toBeNull();
    await act(async () => root.unmount());
  });

  it("does not infer the warning from hidden enemies or Signals0", async () => {
    const campaign = createNewCampaign(42024);
    const state = {
      ...campaign,
      squads: campaign.squads.map((squad, index) => index === 3 ? { ...squad, sector: "sector-1" as const } : squad),
      enemySquads: campaign.enemySquads.map((enemy) => ({ ...enemy, sector: "sector-0" as const, strength: 10 })),
    };
    const root = await mount(state);
    await queueMoves(3);
    await select(4);
    await click(action("MOVE"));
    await target("Whiteplain");
    expect(document.querySelector(".hq-garrison-warning")).toBeTruthy();
    await act(async () => root.unmount());
  });

  it("does not treat a legal ATTACK by the last HQ garrison as a definite departure", async () => {
    const campaign = createNewCampaign(42024);
    const root = await mount({
      ...campaign,
      enemySquads: campaign.enemySquads.map((enemy, index) => index === 0 ? { ...enemy, sector: "sector-1" as const, strength: 10 } : enemy),
    });
    await queueMoves(4);
    await select(4);
    await click(action("ATTACK"));
    await target("Whiteplain");
    expect(document.querySelector(".queued-orders")?.textContent).toContain("ATTACK");
    expect(document.querySelector(".hq-garrison-warning")).toBeNull();
    expect(execute().disabled).toBe(false);
    await act(async () => root.unmount());
  });

  it("does not warn when the HQ garrison is empty", async () => {
    const root = await mount({ ...createNewCampaign(42024), squads: createNewCampaign(42024).squads.map((squad) => ({ ...squad, strength: 0 })) });
    expect(document.querySelector(".hq-garrison-warning")).toBeNull();
    await act(async () => root.unmount());
  });

  it("lists distinct squad identities and named MOVE/ATTACK targets; cancelling preserves the other order", async () => {
    const root = await mount();
    expect(queue().textContent).toContain("No orders queued");
    expect(queue().textContent).toContain(
      "Unassigned squads gain fatigue when the turn executes",
    );
    expect(execute().disabled).toBe(true);
    await target("Whiteplain");
    await select(1);
    await click(action("ATTACK"));
    await target("Lastlight");
    expect(rows()).toHaveLength(2);
    expect(rows()[0].textContent).toContain(
      "SENTINEL squad-1 · MOVE → Whiteplain",
    );
    expect(rows()[1].textContent).toContain(
      "RAIDER squad-2 · ATTACK → Lastlight",
    );
    expect([...document.querySelectorAll(".planned-marker text")].map((item) => item.textContent)).toEqual(["M1", "A2"]);
    expect(document.querySelector('[aria-label="PLAN · MOVE · SENTINEL M1 to Whiteplain"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="PLAN · ATTACK · RAIDER A2 to Lastlight"]')).not.toBeNull();
    expect(rows()[0].querySelector("button")?.getAttribute("aria-label")).toBe(
      "Cancel SENTINEL squad-1 · MOVE → Whiteplain",
    );
    const resources = document.querySelector(".resource-strip")!.textContent;
    await cancel("squad-1");
    expect(rows()).toHaveLength(1);
    expect([...document.querySelectorAll(".planned-marker text")].map((item) => item.textContent)).toEqual(["A2"]);
    expect(rows()[0].textContent).toContain(
      "RAIDER squad-2 · ATTACK → Lastlight",
    );
    expect(document.querySelectorAll(".squad-card em")).toHaveLength(1);
    expect(document.querySelector(".squad-card em")?.textContent).toBe(
      "attack",
    );
    expect(document.querySelector(".resource-strip")!.textContent).toBe(
      resources,
    );
    expect(document.querySelector(".turn-readout strong")?.textContent).toBe(
      "01",
    );
    expect(document.querySelector(".event-rail")?.textContent).toContain(
      "Awaiting first orders",
    );
    expect(budget()).toContain("QUEUED 2M + 3E");
    expect(execute().disabled).toBe(false);
    await click(execute());
    expect(rows()).toHaveLength(0);
    expect(document.querySelectorAll(".squad-card")[0].textContent).toContain(
      "FTG 1",
    );
    expect(document.querySelector(".event-rail")?.textContent).not.toContain(
      "squad-1 hold",
    );
    await act(async () => root.unmount());
  });

  it("cancels paid recovery reservations without refunding spent research resources", async () => {
    const root = await mount();
    for (const index of [0, 1, 2]) {
      await select(index);
      await click(action("RECOVER"));
    }
    await click(
      [...document.querySelectorAll(".research button")].find((button) =>
        button.textContent?.includes("Logistics"),
      )!,
    );
    expect(budget()).toContain("QUEUED 18M + 6E · REMAINING -6M + 13E");
    expect(execute().disabled).toBe(true);
    const spentResources =
      document.querySelector(".resource-strip")!.textContent;
    expect(spentResources).toContain("METAL 12");
    expect(spentResources).toContain("ENERGY 19");
    await cancel("squad-2");
    expect(budget()).toContain("QUEUED 12M + 4E · REMAINING 0M + 15E");
    expect(budget()).not.toContain("SHORT");
    expect(execute().disabled).toBe(false);
    expect(rows()).toHaveLength(2);
    await cancel("squad-1");
    await cancel("squad-3");
    expect(budget()).toContain("QUEUED 0M + 0E · REMAINING 12M + 19E");
    expect(document.querySelector(".resource-strip")!.textContent).toBe(
      spentResources,
    );
    expect(document.querySelector(".turn-readout strong")?.textContent).toBe(
      "01",
    );
    expect(rows()).toHaveLength(0);
    expect(execute().disabled).toBe(true);
    await act(async () => root.unmount());
  });

  it("keeps the persistent recovery comparison while orders change", async () => {
    const root = await mount();
    await select(0);
    expect(
      document.querySelector('[aria-label="Recovery preview"]')?.textContent,
    ).toContain("costs 6 metal + 2 energy");
    expect(
      document.querySelector('[aria-label="Recovery preview"]')?.textContent,
    ).toContain("No benefit");
    expect(
      document.querySelector('[aria-label="Hold preview"]')?.textContent,
    ).toContain("free");
    await click(action("RECOVER"));
    expect(
      document.querySelectorAll('[aria-label="Recovery preview"]'),
    ).toHaveLength(1);
    expect(
      document.querySelector('[aria-label="Recovery order preview"]'),
    ).toBeNull();

    await click(action("HOLD"));
    expect(
      document.querySelector('[aria-label="Recovery preview"]'),
    ).not.toBeNull();

    await click(action("RECOVER"));
    expect(
      document.querySelector('[aria-label="Recovery preview"]'),
    ).not.toBeNull();
    await cancel("squad-1");
    await act(async () => root.unmount());
  });

  it("previews Logistics recovery gains, fatigue reduction, and the strength cap", async () => {
    const base = createNewCampaign(42024);
    const campaign = {
      ...base,
      researchLevels: { ...base.researchLevels, Logistics: 2 },
      squads: base.squads.map((s, i) =>
        i === 0 ? { ...s, strength: 13, fatigue: 1 } : s,
      ),
    };
    const expected = resolveTurn(campaign, [
      { squadId: campaign.squads[0].id, type: "recover" },
    ]).nextState.squads[0];
    const root = await mount(campaign);
    await select(0);
    const preview = document.querySelector(
      '[aria-label="Recovery preview"]',
    )?.textContent;
    expect(preview).toContain(`STR 13 → ${expected.strength}`);
    expect(preview).toContain(`FTG 1 → ${expected.fatigue}`);
    expect(expected.strength).toBe(14);
    expect(expected.fatigue).toBe(0);
    await act(async () => root.unmount());
  });

  it("shows unsupplied recovery as unavailable and disables RECOVER", async () => {
    const base = createNewCampaign(42024);
    const unsupplied = {
      ...base,
      squads: base.squads.map((s, i) =>
        i === 0 ? { ...s, sector: "sector-6" as const } : s,
      ),
    };
    const root = await mount(unsupplied);
    await select(0);
    expect(
      document.querySelector('[aria-label="Recovery preview"]')?.textContent,
    ).toContain("Unavailable outside supplied player territory");
    expect((action("RECOVER") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => root.unmount());
  });

  it("keeps resolveTurn authoritative for unsupplied and no-benefit recovery", () => {
    const campaign = createNewCampaign(42024);
    const unsupplied = {
      ...campaign,
      squads: [{ ...campaign.squads[0], sector: "sector-6" as const }],
    };
    expect(() =>
      resolveTurn(unsupplied, [
        { squadId: unsupplied.squads[0].id, type: "recover" },
      ]),
    ).toThrow("outside supplied territory");
    const noBenefit = resolveTurn(campaign, [
      { squadId: campaign.squads[0].id, type: "recover" },
    ]);
    expect(noBenefit.nextState.squads[0].strength).toBe(
      campaign.squads[0].strength,
    );
    expect(noBenefit.nextState.squads[0].fatigue).toBe(
      campaign.squads[0].fatigue,
    );
  });

  it("recomputes a grouped assault forecast on cancellation and clears it after the last order", async () => {
    const campaign = createNewCampaign(42024);
    const initialGame = {
      ...campaign,
      squads: campaign.squads.map((squad) => ({
        ...squad,
        sector: "sector-5" as const,
      })),
    };
    const root = await mount(initialGame);
    await click(action("ATTACK"));
    await target("Ashenfall");
    await select(1);
    await target("Ashenfall");
    expect(rows()).toHaveLength(2);
    expect(document.querySelector(".expected-losses")).not.toBeNull();
    await cancel("squad-1");
    const planned = resolveTurn(initialGame, [{ squadId: "squad-2", type: "attack", target: "sector-6" }]);
    expect(document.querySelector(".expected-losses")?.textContent)
      .toContain("outcome and losses are uncertain");
    expect(budget()).toContain("QUEUED 2M + 3E · REMAINING 18M + 17E");
    await cancel("squad-2");
    expect(document.querySelector(".expected-losses")).toBeNull();
    expect(rows()).toHaveLength(0);
    expect(queue().textContent).toContain("No orders queued");
    expect(execute().disabled).toBe(true);
    expect(budget()).toContain("QUEUED 0M + 0E · REMAINING 20M + 20E");
    await act(async () => root.unmount());
  });

  it("replaces an order with one updated row and clears the list on execute and reset", async () => {
    const root = await mount();
    await target("Whiteplain");
    await click(action("ATTACK"));
    await target("Lastlight");
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain(
      "SENTINEL squad-1 · ATTACK → Lastlight",
    );
    expect(queue().textContent).not.toContain("Whiteplain");
    await click(action("HOLD"));
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain("SENTINEL squad-1 · HOLD");
    expect(queue().textContent).not.toContain("Lastlight");
    await click(execute());
    expect(rows()).toHaveLength(0);
    expect(execute().disabled).toBe(true);
    await click(action("RECOVER"));
    expect(rows()).toHaveLength(1);
    await click(
      [...document.querySelectorAll("button")].find(
        (button) => button.textContent?.startsWith("NEW CAMPAIGN"),
      )!,
    );
    expect(rows()).toHaveLength(0);
    expect(queue().textContent).toContain("No orders queued");
    expect(execute().disabled).toBe(true);
    expect(budget()).toContain("QUEUED 0M + 0E · REMAINING 20M + 20E");
    await act(async () => root.unmount());
  });

  it.each(["victory", "defeat"] as const)(
    "prevents map or action edits in a completed %s campaign",
    async (terminal) => {
      const root = await mount({ ...createNewCampaign(42024), terminal });
      expect(queue().textContent).toContain("Campaign complete");
      await target("Whiteplain");
      const mapTarget = document.querySelector(
        '[role="button"][aria-label^="Whiteplain,"]',
      )!;
      await act(async () => {
        mapTarget.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      });
      expect(mapTarget.getAttribute("aria-disabled")).toBe("true");
      expect(mapTarget.getAttribute("tabindex")).toBe("-1");
      expect(
        [...document.querySelectorAll(".order-buttons button")].every(
          (button) => (button as HTMLButtonElement).disabled,
        ),
      ).toBe(true);
      expect(rows()).toHaveLength(0);
      expect(
        (queue().querySelector("button") as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(execute().disabled).toBe(true);
      await act(async () => root.unmount());
    },
  );

  it("autosaves research and resumes it after remount", async () => {
    const game = {
      ...createNewCampaign(42024),
      resources: { ...createNewCampaign(42024).resources, intelligence: 20 },
    };
    writeSave({ version: SAVE_VERSION, game, events: [], reports: [] });
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App />));
    await click([...document.querySelectorAll("button")].find((button) => button.textContent?.startsWith("CONTINUE"))!);
    await click(
      [...document.querySelectorAll(".research button")].find((button) =>
        button.textContent?.startsWith("Signals"),
      )!,
    );
    expect(readSave()?.game.researchLevels.Signals).toBe(1);
    await act(async () => root.unmount());
    document.body.innerHTML = '<div id="root"></div>';
    const resumed = createRoot(document.getElementById("root")!);
    await act(async () => resumed.render(<App />));
    expect(document.body.textContent).toContain("SAVED CAMPAIGN AVAILABLE — SEED 42024 · TURN 1");
    await click(
      [...document.querySelectorAll("button")].find((button) =>
        button.textContent?.startsWith("CONTINUE"),
      )!,
    );
    expect(document.body.textContent).toContain("CONTINUING SAVED CAMPAIGN");
    expect(document.body.textContent).toContain("Signals 1/2");
    await act(async () => resumed.unmount());
  });

  it("keeps a valid saved snapshot pending until CONTINUE, reset, or new seed is chosen", async () => {
    const saved = { ...createNewCampaign(77), turn: 3 };
    writeSave({ version: SAVE_VERSION, game: saved, events: [], reports: [], rulesVersion: 1, journalVersion: 1, journal: [] });
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App />));
    expect(document.body.textContent).toContain("SAVED CAMPAIGN AVAILABLE — SEED 77 · TURN 3");
    expect(readSave()?.game).toEqual(saved);
    await click([...document.querySelectorAll("button")].find((button) => button.textContent?.startsWith("RESET SAME SEED"))!);
    expect(readSave()?.game.seed).toBe(77);
    expect(readSave()?.game.turn).toBe(1);
    expect(document.body.textContent).toContain("RESET SAME SEED · 77");
    await act(async () => root.unmount());

    document.body.innerHTML = '<div id="root"></div>';
    const second = createRoot(document.getElementById("root")!);
    await act(async () => second.render(<App />));
    await click([...document.querySelectorAll("button")].find((button) => button.textContent?.startsWith("NEW CAMPAIGN · NEW SEED"))!);
    expect(readSave()?.game.seed).not.toBe(77);
    await act(async () => second.unmount());
  });

  it("keeps a legacy snapshot journal-unavailable through a turn and reload", async () => {
    const game = { ...createNewCampaign(77), turn: 3 };
    writeSave({ version: 1, game, events: [], reports: [] });
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App />));
    await act(async () => (document.querySelector('button') as HTMLButtonElement).click());
    await act(async () => ([...document.querySelectorAll('.order-buttons button')].find((button) => button.textContent === "HOLD") as HTMLButtonElement).click());
    await act(async () => (document.querySelector('.execute') as HTMLButtonElement).click());
    expect(JSON.parse(localStorage.getItem(SAVE_KEY)!).journal).toBeUndefined();
    await act(async () => root.unmount());

    document.body.innerHTML = '<div id="root"></div>';
    const reloaded = createRoot(document.getElementById("root")!);
    await act(async () => reloaded.render(<App />));
    await act(async () => (document.querySelector('button') as HTMLButtonElement).click());
    await act(async () => ([...document.querySelectorAll('.order-buttons button')].find((button) => button.textContent === "HOLD") as HTMLButtonElement).click());
    expect(JSON.parse(localStorage.getItem(SAVE_KEY)!).journal).toBeUndefined();
    await act(async () => reloaded.unmount());
  });

  it("continues an unsupported snapshot into ordinary journal-unavailable saving", async () => {
    const game = { ...createNewCampaign(88), turn: 4 };
    writeSave({ version: SAVE_VERSION, game, events: [], reports: [], rulesVersion: 99, journalVersion: 99, journal: [] });
    const before = localStorage.getItem(SAVE_KEY);
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App />));
    await act(async () => (document.querySelector('button') as HTMLButtonElement).click());
    expect(localStorage.getItem(SAVE_KEY)).toBe(before);
    expect(readSave()?.game).toEqual(game);
    await act(async () => ([...document.querySelectorAll('.order-buttons button')].find((button) => button.textContent === "HOLD") as HTMLButtonElement).click());
    await act(async () => (document.querySelector('.execute') as HTMLButtonElement).click());
    expect(readSave()?.game.turn).toBe(5);
    expect(JSON.parse(localStorage.getItem(SAVE_KEY)!).journal).toBeUndefined();
    expect(document.body.textContent).toContain("saved");
    await act(async () => root.unmount());

    document.body.innerHTML = '<div id="root"></div>';
    const reloaded = createRoot(document.getElementById("root")!);
    await act(async () => reloaded.render(<App />));
    expect(document.body.textContent).toContain("SAVED CAMPAIGN AVAILABLE — SEED 88 · TURN 5");
    await act(async () => ([...document.querySelectorAll('button')].find((button) => button.textContent === "CONTINUE") as HTMLButtonElement).click());
    await act(async () => ([...document.querySelectorAll('button')].find((button) => button.textContent === "VERIFY REPLAY") as HTMLButtonElement).click());
    expect(document.body.textContent).toContain("REPLAY UNAVAILABLE — this older campaign has no action journal.");
    await act(async () => reloaded.unmount());
  });

  it("writes a current supported empty journal on explicit reset", async () => {
    const game = { ...createNewCampaign(99), turn: 4 };
    writeSave({ version: SAVE_VERSION, game, events: [], reports: [], rulesVersion: 99, journalVersion: 99, journal: [] });
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App />));
    await act(async () => ([...document.querySelectorAll('button')].find((button) => button.textContent?.startsWith("RESET SAME SEED")) as HTMLButtonElement).click());
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY)!);
    expect(saved.version).toBe(SAVE_VERSION);
    expect(saved.rulesVersion).toBe(2);
    expect(saved.journalVersion).toBe(1);
    expect(saved.journal).toEqual([]);
    expect(saved.game.seed).toBe(99);
    expect(saved.game.turn).toBe(1);
    await act(async () => root.unmount());
  });

  it("keeps SAVE UNAVAILABLE after quota failure when VERIFY performs no write", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App />));
    await act(async () => ([...document.querySelectorAll('.order-buttons button')].find((button) => button.textContent === "HOLD") as HTMLButtonElement).click());
    await act(async () => (document.querySelector('.execute') as HTMLButtonElement).click());
    expect(document.body.textContent).toContain("SAVE UNAVAILABLE");
    const writes = setItem.mock.calls.length;
    await act(async () => ([...document.querySelectorAll('button')].find((button) => button.textContent === "VERIFY REPLAY") as HTMLButtonElement).click());
    expect(document.body.textContent).toContain("SAVE UNAVAILABLE");
    expect(setItem.mock.calls).toHaveLength(writes);
    setItem.mockRestore();
    await act(async () => root.unmount());
  });

  it("persists the fresh no-save path with a journal initialized as an array", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App />));
    await act(async () => ([...document.querySelectorAll('.order-buttons button')].find((button) => button.textContent === "HOLD") as HTMLButtonElement).click());
    await act(async () => (document.querySelector('.execute') as HTMLButtonElement).click());
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY)!);
    expect(saved.journal).toEqual([{ type: "orders", orders: [{ squadId: "squad-1", type: "hold" }] }]);
    await act(async () => root.unmount());
  });

  it("resets the campaign and persists terminal reason after remount", async () => {
    storage.localStorage.clear();
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App />));
    const beforeSeed = readSave()?.game.seed;
    await click(
      [...document.querySelectorAll("button")].find(
        (button) => button.textContent?.startsWith("NEW CAMPAIGN"),
      )!,
    );
    expect(readSave()?.game).toBeDefined();
    expect(readSave()?.game.terminal).toBe("active");
    expect(readSave()?.game.seed).not.toBe(beforeSeed);
    await act(async () => root.unmount());

    const terminal = {
      ...createNewCampaign(42024),
      terminal: "defeat" as const,
      terminalReason: "Turn 18 reached without victory.",
    };
    writeSave({
      version: SAVE_VERSION,
      game: terminal,
      events: [],
      reports: [],
    });
    document.body.innerHTML = '<div id="root"></div>';
    const resumed = createRoot(document.getElementById("root")!);
    await act(async () => resumed.render(<App />));
    await click([...document.querySelectorAll("button")].find((button) => button.textContent?.startsWith("CONTINUE"))!);
    expect(document.body.textContent).toContain(
      "Turn 18 reached without victory.",
    );
    await act(async () => resumed.unmount());
    expect(SAVE_KEY).toBe("rimeward:campaign");
  });

  it("keeps a failed save warning through queue/cancel and clears it after a successful save", async () => {
    storage.localStorage.clear();
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<App />));
    await click(action("HOLD"));
    await click(execute());
    expect(document.body.textContent).toContain("SAVE UNAVAILABLE");
    await target("Whiteplain");
    expect(document.body.textContent).toContain("SAVE UNAVAILABLE");
    await cancel("squad-1");
    expect(document.body.textContent).toContain("SAVE UNAVAILABLE");
    setItem.mockRestore();
    await click(
      [...document.querySelectorAll(".research button")].find((button) =>
        button.textContent?.startsWith("Signals"),
      )!,
    );
    expect(document.body.textContent).toContain(
      "Completed turns and research saved; queued orders are not saved.",
    );
    expect(document.body.textContent).not.toContain("SAVE UNAVAILABLE");
    await act(async () => root.unmount());
  });

  it("shows named relay and HQ objectives with authoritative states and countdown", async () => {
    const campaign = createNewCampaign(42024);
    const root = await mount({
      ...campaign,
      turn: 18,
      objectives: campaign.objectives.map((objective, index) => ({
        ...objective,
        controlled: index === 0,
      })),
      sectors: campaign.sectors.map((sector) =>
        sector.id === campaign.hq.enemy
          ? { ...sector, owner: "player" as const }
          : sector,
      ),
    });
    const tracker = document.querySelector(
      '[aria-label="Campaign objectives"]',
    )!;
    expect(tracker.textContent).toContain("Relay — Northstar · SECURED");
    expect(tracker.textContent).toContain("Relay — Vesper · REQUIRED");
    expect(tracker.textContent).toContain("Relay — Ashenfall · REQUIRED");
    expect(tracker.textContent).toContain("Enemy HQ — Ashenfall · CAPTURED");
    expect(tracker.textContent).toContain(
      "1 PLAYABLE TURN REMAINING INCLUDING THIS TURN",
    );
    expect(tracker.textContent).toContain(
      `Secure all relays and capture enemy HQ. Defend ${campaign.sectors.find((sector) => sector.id === campaign.hq.player)?.name}.`,
    );
    expect(document.querySelectorAll(".objective")).toHaveLength(4);
    await act(async () => root.unmount());
  });

  it("removes the active countdown when the campaign is terminal", async () => {
    const campaign = createNewCampaign(42024);
    const root = await mount({
      ...campaign,
      terminal: "victory",
      terminalReason: "Campaign complete.",
    });
    expect(document.body.textContent).toContain("Campaign complete.");
    expect(
      document.querySelector('[aria-label="Campaign objectives"]')?.textContent,
    ).toContain("CAMPAIGN COMPLETE");
    expect(
      document.querySelector('[aria-label="Campaign objectives"]')?.textContent,
    ).not.toContain("PLAYABLE TURNS REMAINING");
    await act(async () => root.unmount());
  });

  it("traces distinct queued plans, including shared targets, and clears them on replacement or cancel", async () => {
    const root = await mount(createNewCampaign(42024));
    const chooseMove = async (squadIndex: number) => {
      await act(async () => (document.querySelectorAll(".squad-card")[squadIndex] as HTMLButtonElement).click());
      await act(async () => (document.querySelector('[role="button"][aria-label*="Whiteplain"]') as SVGGElement).dispatchEvent(new MouseEvent("click", { bubbles: true })));
    };
    await chooseMove(0);
    await chooseMove(1);
    expect(document.querySelectorAll(".planned-order")).toHaveLength(2);
    expect(document.querySelectorAll(".planned-route")).toHaveLength(2);
    expect(new Set([...document.querySelectorAll(".planned-order")].map((item) => item.getAttribute("data-order-id"))).size).toBe(2);
    expect(new Set([...document.querySelectorAll(".planned-route")].map((item) => `${item.getAttribute("x1")},${item.getAttribute("y1")},${item.getAttribute("x2")},${item.getAttribute("y2")}`))).toHaveLength(2);
    expect(document.querySelector(".planned-arrow-move")?.getAttribute("fill")).toBe("#f0dda1");
    expect(document.querySelector(".planned-arrow-move")?.getAttribute("stroke")).toBe("#071114");
    expect(document.querySelectorAll(".planned-label")).toHaveLength(0);
    expect(document.querySelectorAll(".planned-marker text")[0].textContent).toMatch(/^M\d+$/);
    await act(async () => (document.querySelector('.queued-order button') as HTMLButtonElement).click());
    expect(document.querySelectorAll(".planned-order")).toHaveLength(1);
    await act(async () => (document.querySelector('.queued-order button') as HTMLButtonElement).click());
    expect(document.querySelectorAll(".planned-order")).toHaveLength(0);
    await act(async () => root.unmount());
  });

  it("shows a readable key for planned map routes", async () => {
    const root = await mount();

    await target("Whiteplain");
    await select(1);
    await click(action("ATTACK"));
    await target("Lastlight");

    const legend = document.querySelector('[aria-label="Map legend"]');
    expect(legend?.textContent).toContain("PLAN · MOVE");
    expect(legend?.textContent).toContain("PLAN · ATTACK");
    expect(legend?.querySelector(".plan-line.move")).toBeTruthy();
    expect(legend?.querySelector(".plan-line.attack")).toBeTruthy();
    expect(legend?.querySelectorAll(".plan-entry")).toHaveLength(2);
    expect(legend?.textContent).toContain("squad-1 · MOVE → Whiteplain");
    expect(legend?.textContent).toContain("squad-2 · ATTACK → Lastlight");

    await act(async () => root.unmount());
  });

  it("routes a multi-queue to distinct targets, executes both plans, and clears the map trace", async () => {
    const root = await mount();
    await target("Whiteplain");
    await select(1);
    await click(action("MOVE"));
    await target("Lastlight");

    expect(rows()).toHaveLength(2);
    expect(rows()[0].textContent).toContain("squad-1 · MOVE → Whiteplain");
    expect(rows()[1].textContent).toContain("squad-2 · MOVE → Lastlight");
    const endpoints = [...document.querySelectorAll(".planned-route")].map(
      (route) => `${route.getAttribute("x2")},${route.getAttribute("y2")}`,
    );
    expect(new Set(endpoints).size).toBe(2);
    expect(document.querySelectorAll(".planned-order")).toHaveLength(2);

    await click(execute());

    expect(rows()).toHaveLength(0);
    expect(document.querySelectorAll(".planned-order")).toHaveLength(0);
    expect(document.querySelector(".event-rail")?.textContent).toContain(
      "squad-1 move Whiteplain",
    );
    expect(document.querySelector(".event-rail")?.textContent).toContain(
      "squad-2 move Lastlight",
    );
    await act(async () => root.unmount());
  });

  it("numbers two through five shared MOVE routes with accessible per-order details", async () => {
    const campaign = createNewCampaign(42024);
    const origin = campaign.squads[0].sector;
    const shared = {
      ...campaign,
      squads: campaign.squads.map((unit, index) =>
        index < 5 ? { ...unit, sector: origin } : { ...unit, strength: 0 },
      ),
    };
    const root = await mount(shared);
    const choose = async (index: number) => {
      await act(async () => (document.querySelectorAll(".squad-card")[index] as HTMLButtonElement).click());
      await act(async () => (document.querySelector('[role="button"][aria-label*="move target"]') as SVGGElement).dispatchEvent(new MouseEvent("click", { bubbles: true })));
    };
    for (let index = 0; index < 5; index += 1) await choose(index);
    expect(document.querySelectorAll(".planned-marker")).toHaveLength(5);
    expect([...document.querySelectorAll(".planned-marker text")].map((item) => item.textContent)).toEqual(["M1", "M2", "M3", "M4", "M5"]);
    expect(document.querySelector(".plan-legend")?.textContent).toContain("PLAN = queued order");
    expect(document.querySelectorAll('.planned-marker[role="img"]')).toHaveLength(5);
    expect(document.querySelectorAll(".plan-entry")).toHaveLength(5);
    expect(document.body.textContent).toContain("RECON squad-3 · MOVE → Whiteplain");
    await act(async () => (document.querySelector(".execute") as HTMLButtonElement).click());
    expect(document.querySelectorAll(".planned-order")).toHaveLength(0);
    expect(document.querySelectorAll(".planned-marker")).toHaveLength(0);
    await act(async () => root.unmount());
  });

  it("persists one actual destination through execute and reload", async () => {
    window.localStorage.clear();
    const root = await mount();
    await target("Whiteplain");
    expect(rows()).toHaveLength(1);
    await click(execute());
    expect(document.querySelector(".event-rail")?.textContent).toContain(
      "squad-1 move Whiteplain",
    );
    expect(document.querySelector(".event-rail")?.textContent).not.toContain(
      "squad-1 move sector-11",
    );
    await act(async () => root.unmount());

    const reloaded = await mount();
    expect(document.querySelector(".event-rail")?.textContent).toContain(
      "squad-1 move Whiteplain",
    );
    expect(rows()).toHaveLength(0);
    await act(async () => reloaded.unmount());
    window.localStorage.clear();
  });

  it("replaces one squad plan, executes the remaining queue, and does not restore queued orders on restart", async () => {
    window.localStorage.clear();
    const root = await mount();
    await select(0);
    await click(action("MOVE"));
    await target("Whiteplain");
    expect(rows()).toHaveLength(1);
    await click(action("ATTACK"));
    await target("Lastlight");
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain("ATTACK");
    expect(document.querySelectorAll(".planned-order")).toHaveLength(1);
    await select(1);
    await click(action("MOVE"));
    await target("Whiteplain");
    expect(rows()).toHaveLength(2);
    await click(execute());
    expect(rows()).toHaveLength(0);
    expect(document.querySelectorAll(".planned-order")).toHaveLength(0);
    await act(async () => root.unmount());

    const restarted = await mount();
    expect(rows()).toHaveLength(0);
    expect(document.querySelectorAll(".planned-order")).toHaveLength(0);
    await act(async () => restarted.unmount());
    window.localStorage.clear();
  });

  it("removes queued map plans when the campaign is already terminal", async () => {
    const root = await mount({ ...createNewCampaign(42024), terminal: "victory", terminalReason: "Campaign complete." });
    expect(document.querySelectorAll(".planned-order")).toHaveLength(0);
    expect(execute().disabled).toBe(true);
    await act(async () => root.unmount());
  });

  it("announces the resolved turn and exposes non-blocking visual feedback", async () => {
    const root = await mount();
    await target("Whiteplain");
    await click(execute());
    expect(document.querySelector('.debrief-panel [aria-live="polite"]')?.textContent).toContain("WHAT CHANGED");
    expect(document.querySelector('[aria-label="Resolved actions for turn 1"]')).toBeTruthy();
    expect(document.querySelector(".resolved-route")).toBeTruthy();
    expect(document.querySelector(".resolved-route")?.getAttribute("class")).toContain("resolved-move");
    const map = document.querySelector(".map")!;
    expect(map.querySelector(".resolved-route")!.compareDocumentPosition(map.querySelector(".sector")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(map.querySelector(".casualty-feedback")!.compareDocumentPosition(map.querySelector(".sector")!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(map.querySelector(".casualty-feedback")?.getAttribute("pointer-events")).toBe("none");
    await act(async () => root.unmount());
  });
});
});
