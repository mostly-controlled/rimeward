export type UnitClass = "Sentinel" | "Raider" | "Recon" | "Artillery";
export type Terrain = "ice" | "ridge" | "tundra" | "crater";
export type OrderType = "hold" | "recover" | "move" | "attack";
export type ResearchBranch = "Logistics" | "Warfare" | "Signals";
export type TerminalStatus = "active" | "victory" | "defeat";

export type SectorId = `sector-${number}`;
export type Resources = { metal: number; energy: number; intelligence: number };
export type Sector = {
  id: SectorId;
  name: string;
  terrain: Terrain;
  links: SectorId[];
  owner: "player" | "enemy" | "neutral";
  yields: Resources;
};
export type Squad = {
  id: string;
  class: UnitClass;
  strength: number;
  fatigue: number;
  home: SectorId;
  sector: SectorId;
  experience: number;
  upgrades: string[];
};
export type EnemySquad = {
  id: string;
  strength: number;
  sector: SectorId;
  class: UnitClass;
};
export type Objective = { id: string; sector: SectorId; controlled: boolean };
export type GameState = {
  seed: number;
  turn: number;
  sectors: Sector[];
  objectives: Objective[];
  hq: { player: SectorId; enemy: SectorId };
  squads: Squad[];
  enemySquads: EnemySquad[];
  resources: Resources;
  research: number;
  researchLevels: Record<ResearchBranch, number>;
  recentBattles: string[];
  orderHistory: Order[][];
  enemyHistory: EnemyIntent[];
  adaptiveHistory: AdaptiveHistoryBucket[];
  strategicIntent?: EnemyIntent;
  strategicTarget?: StrategicTarget;
  terminal: TerminalStatus;
  terminalReason?: string;
  income: Resources;
  revealedEnemySquads: string[];
  scoutedEnemyRoutes: string[];
  supplyCapacity: number;
};
export type Order = { squadId: string; type: OrderType; target?: SectorId };
export type GameEvent = {
  type: "hold" | "recover" | "move" | "attack";
  squadId: string;
  from: SectorId;
  to: SectorId;
  target?: SectorId;
  message: string;
  faction?: "player" | "enemy";
};
export type EnemyIntent = {
  squadId: string;
  kind: "wait" | "hold" | "move" | "attack";
  from: SectorId;
  to?: SectorId;
  target?: SectorId;
};
export type AdaptiveObservation = {
  kind: "move" | "attack";
  class: UnitClass;
  from: SectorId;
  to?: SectorId;
  target?: SectorId;
};
export type AdaptiveHistoryBucket = {
  turn: number;
  observations: AdaptiveObservation[];
};
export type StrategicTarget = { squadId: string; destination: SectorId };
export type BattleReport = {
  target: SectorId;
  terrain: Terrain;
  attackers: {
    squadId: string;
    class: UnitClass;
    strength: number;
    units: number;
  }[];
  defenders: {
    squadId: string;
    class: UnitClass;
    strength: number;
    units: number;
  }[];
  classAdvantages: string[];
  defenderCounters: string[];
  terrainMultiplier: number;
  fatiguePenalty: number;
  variance: number;
  attackerPower: number;
  defenderPower: number;
  winner: "player" | "enemy" | "draw";
  casualties: { squadId: string; side: "player" | "enemy"; strength: number }[];
  playerCasualties: number;
  enemyCasualties: number;
  retreat: { squadId: string; to: SectorId }[];
  captured: boolean;
  relayControlled: boolean;
};
const terrainPower: Record<Terrain, number> = {
  ice: 0.9,
  ridge: 1.15,
  tundra: 1,
  crater: 1.05,
};

const names = [
  "Frostgate",
  "Whiteplain",
  "Cairnwatch",
  "Northstar",
  "Rimefield",
  "Glassway",
  "Ashenfall",
  "Dawnscar",
  "Ironhollow",
  "Vesper",
  "Bluevault",
  "Lastlight",
];
const terrains: Terrain[] = ["ice", "tundra", "ridge", "crater"];
const classes: UnitClass[] = ["Sentinel", "Raider", "Recon", "Artillery"];
const id = (n: number): SectorId => `sector-${n}`;

const rng = (seed: number) => {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
};

export const createNewCampaign = (seed: number): GameState => {
  const random = rng(seed);
  const sectors = names.map((name, i): Sector => ({
    id: id(i),
    name,
    terrain: terrains[i % terrains.length],
    links: [id((i + 1) % 12), id((i + 11) % 12)],
    owner: i === 0 ? "player" : i === 6 ? "enemy" : "neutral",
    yields: {
      metal: i === 0 || i === 2 || i === 10 || i === 3 || i === 9 ? 1 : 0,
      energy: i === 0 || i === 2 || i === 10 || i === 3 || i === 9 ? 1 : 0,
      intelligence: i === 0 ? 1 : 0,
    },
  }));
  // Add fixed cross-links so the map is hex-like while remaining fully deterministic.
  for (const [a, b] of [
    [1, 5],
    [3, 8],
    [7, 10],
  ] as const) {
    sectors[a].links.push(id(b));
    sectors[b].links.push(id(a));
  }
  const objectiveIndexes = [3, 6, 9];
  const squads = classes.concat("Sentinel").map((unitClass, i): Squad => ({
    id: `squad-${i + 1}`,
    class: unitClass,
    strength: 10,
    fatigue: 0,
    home: id(0),
    sector: id(0),
    experience: 0,
    upgrades: [],
  }));
  const enemySquads = [0, 1, 2].map((i): EnemySquad => ({
    id: `enemy-${i + 1}`,
    class: classes[Math.floor(random() * classes.length)],
    strength: 7 + Math.floor(random() * 3),
    sector: id([6, 8, 10][i]),
  }));
  const initial = {
    seed: seed >>> 0,
    turn: 1,
    sectors,
    objectives: objectiveIndexes.map((n, i) => ({
      id: `relay-${i + 1}`,
      sector: id(n),
      controlled: false,
    })),
    hq: { player: id(0), enemy: id(6) },
    squads,
    enemySquads,
    resources: { metal: 20, energy: 20, intelligence: 5 },
    research: 0,
    researchLevels: { Logistics: 0, Warfare: 0, Signals: 0 },
    recentBattles: [],
    orderHistory: [],
    enemyHistory: [],
    adaptiveHistory: [],
    strategicIntent: undefined,
    strategicTarget: undefined,
    terminal: "active" as const,
    income: { metal: 0, energy: 0, intelligence: 0 },
    revealedEnemySquads: [],
    scoutedEnemyRoutes: [],
    supplyCapacity: 10,
  };
  initial.income = calculateIncome(initial);
  return initial;
};

const error = (message: string): never => {
  throw new Error(message);
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const counterClass: Record<UnitClass, UnitClass> = {
  Sentinel: "Raider",
  Raider: "Recon",
  Recon: "Artillery",
  Artillery: "Sentinel",
};
const adjacentOrSame = (state: GameState, a: SectorId, b: SectorId): boolean =>
  a === b || Boolean(state.sectors.find((sector) => sector.id === a)?.links.includes(b));
const observationDestination = (observation: AdaptiveObservation): SectorId =>
  observation.kind === "move"
    ? observation.to ?? observation.from
    : observation.target ?? observation.from;
const observationCorridor = (observation: AdaptiveObservation): string =>
  `${observation.from}>${observationDestination(observation)}`;
const recentAdaptiveBuckets = (state: GameState): AdaptiveHistoryBucket[] =>
  (Array.isArray(state.adaptiveHistory) ? state.adaptiveHistory : [])
    .filter((bucket) => Number.isInteger(bucket.turn) && bucket.turn >= state.turn - 3)
    .sort((a, b) => a.turn - b.turn);
const committedObservation = (bucket: AdaptiveHistoryBucket): AdaptiveObservation =>
  bucket.observations.at(-1)!;

type AdaptiveStyle = "AGGRESSIVE" | "DEFENSIVE" | "UNSET";
export const adaptiveStyle = (state: GameState): AdaptiveStyle => {
  const buckets = recentAdaptiveBuckets(state);
  const observed = buckets.filter((bucket) => bucket.observations.length > 0);
  const latest = observed.at(-1)?.observations ?? [];
  if (!latest.length) return "UNSET";
  let classConfidence = 0;
  let corridorConfidence = 0;
  let previousClass: UnitClass | undefined;
  let previousCorridor: string | undefined;
  for (const bucket of observed) {
    const observation = committedObservation(bucket);
    const corridor = observationCorridor(observation);
    classConfidence = observation.class === previousClass ? classConfidence + 1 : 1;
    corridorConfidence = corridor === previousCorridor ? corridorConfidence + 1 : 1;
    previousClass = observation.class;
    previousCorridor = corridor;
  }
  const personality = pressureHash(state, "adaptive-style", 0) % 2 === 0;
  const threshold = personality ? 2 : 3;
  if (classConfidence >= threshold || corridorConfidence >= threshold)
    return personality ? "AGGRESSIVE" : "DEFENSIVE";
  return "UNSET";
};
export const adaptiveStyleCue = (state: GameState): string => {
  const buckets = recentAdaptiveBuckets(state);
  const observed = buckets.filter((bucket) => bucket.observations.length > 0);
  const latest = observed.at(-1) ? committedObservation(observed.at(-1)!) : undefined;
  const styleName = pressureHash(state, "adaptive-style", 0) % 2 === 0
    ? "Aggressive raider"
    : "Defensive planner";
  if (!latest) return `${styleName} · no pattern yet`;
  if (adaptiveStyle(state) === "UNSET")
    return `${styleName} · ${observed.length === 1 ? "pressure noticed" : "response uncertain"}`;
  return `${styleName} · ${adaptiveStyle(state) === "AGGRESSIVE" ? "pressure noticed" : "response uncertain"}`;
};
const appendAdaptiveBucket = (
  state: GameState,
  bucket: AdaptiveHistoryBucket,
): AdaptiveHistoryBucket[] =>
  [
    ...(Array.isArray(state.adaptiveHistory) ? state.adaptiveHistory : []).filter(
      (entry) => entry.turn !== bucket.turn,
    ),
    bucket,
  ]
    .sort((a, b) => a.turn - b.turn)
    .slice(-3);
const supplied = (state: GameState, sectorId: SectorId): boolean => {
  const owned = new Set(
    state.sectors
      .filter((sector) => sector.owner === "player")
      .map((sector) => sector.id),
  );
  const reached = new Set<SectorId>([state.hq.player]);
  const queue: Array<{ id: SectorId; distance: number }> = [
    { id: state.hq.player, distance: 0 },
  ];
  while (queue.length) {
    const current = queue.shift()!;
    if (reached.size >= state.supplyCapacity) continue;
    state.sectors
      .find((sector) => sector.id === current.id)
      ?.links.forEach((link) => {
        if (
          reached.size < state.supplyCapacity &&
          owned.has(link) &&
          !reached.has(link)
        ) {
          reached.add(link);
          queue.push({ id: link, distance: current.distance + 1 });
        }
      });
  }
  return reached.has(sectorId);
};
export const connectedOwnedSectors = (state: GameState): Sector[] =>
  state.sectors.filter(
    (sector) => sector.owner === "player" && supplied(state, sector.id),
  );
export const calculateIncome = (state: GameState): Resources => {
  const connected = new Set(connectedOwnedSectors(state).map((s) => s.id));
  const raw = state.sectors.reduce((sum, sector) => {
    if (sector.owner !== "player" || !connected.has(sector.id))
      return sum;
    const interrupted = state.enemySquads.some(
      (enemy) => enemy.strength > 0 && enemy.sector === sector.id,
    );
    if (interrupted) return sum;
    const site =
      sector.id === state.hq.player
        ? { metal: 2, energy: 2, intelligence: 1 }
        : sector.id === "sector-2" || sector.id === "sector-10" ||
            sector.id === "sector-3" || sector.id === "sector-9"
          ? { metal: 1, energy: 1, intelligence: 0 }
          : { metal: 0, energy: 0, intelligence: 0 };
    return {
      metal: sum.metal + site.metal,
      energy: sum.energy + site.energy,
      intelligence: sum.intelligence + site.intelligence,
    };
  }, { metal: 0, energy: 0, intelligence: 0 });
  return {
    metal: Math.min(6, raw.metal),
    energy: Math.min(6, raw.energy),
    intelligence: Math.min(1, raw.intelligence),
  };
};
export const researchCost = (
  branch: ResearchBranch,
  level: number,
): Resources => {
  const costs: Record<ResearchBranch, Resources[]> = {
    Logistics: [
      { metal: 8, energy: 1, intelligence: 0 },
      { metal: 12, energy: 2, intelligence: 0 },
    ],
    Warfare: [
      { metal: 1, energy: 8, intelligence: 0 },
      { metal: 2, energy: 12, intelligence: 0 },
    ],
    Signals: [
      { metal: 2, energy: 0, intelligence: 4 },
      { metal: 3, energy: 0, intelligence: 7 },
    ],
  };
  return costs[branch][level];
};
const ATTACK_ENERGY_COST = 3;
const ATTACK_METAL_COST = 2;
const RECOVERY_METAL_COST = 6;
const RECOVERY_ENERGY_COST = 2;
export const recoveryMetalCost = (
  _state: Pick<GameState, "researchLevels">,
): number => RECOVERY_METAL_COST;
export const researchCurrency = (branch: ResearchBranch): keyof Resources =>
  branch === "Logistics"
    ? "metal"
    : branch === "Warfare"
      ? "energy"
      : "intelligence";
export const researchIncomeThreshold = (
  _branch: ResearchBranch,
  _level: number,
): number => 1;
const pressureHash = (
  state: GameState,
  key: string,
  phaseTurn = state.turn,
): number => {
  let value = state.seed >>> 0;
  for (const character of `${phaseTurn}:${key}`)
    value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0;
  return value >>> 0;
};
const choosePressureTarget = (
  state: GameState,
  targets: SectorId[],
  phaseTurn = state.turn,
  strategic = false,
  forwardPressure = false,
): SectorId | undefined => {
  const hasEnemyRelayPressure = state.enemySquads.some((enemy) =>
    state.objectives.some((objective) => objective.sector === enemy.sector),
  );
  // A relay remains strategically valuable after capture: it is a supply and
  // income node, so finite hostiles should contest it instead of wandering
  // toward the next neutral objective. The current-board relay HOLD rule
  // still wins when an enemy is already garrisoning an uncaptured relay.
  const threatenedRelays = state.objectives
    .filter(
      (objective) =>
        state.sectors.find((sector) => sector.id === objective.sector)
          ?.owner !== "enemy",
    )
    .map((objective) => objective.sector);
  const strategicTargets = new Set<SectorId>(
    forwardPressure && hasEnemyRelayPressure
      ? [state.hq.player]
      : [state.hq.player, ...threatenedRelays],
  );
  const distanceToStrategic = (start: SectorId): number => {
    if (strategicTargets.has(start)) return 0;
    const seen = new Set<SectorId>([start]);
    const queue: Array<[SectorId, number]> = [[start, 0]];
    while (queue.length) {
      const [current, distance] = queue.shift()!;
      const sector = state.sectors.find((item) => item.id === current);
      for (const link of sector?.links ?? []) {
        if (strategicTargets.has(link)) return distance + 1;
        if (!seen.has(link)) {
          seen.add(link);
          queue.push([link, distance + 1]);
        }
      }
    }
    return Number.MAX_SAFE_INTEGER;
  };
  return targets.slice().sort((a, b) => {
    if (strategic) {
      const aObjective = strategicTargets.has(a) ? 0 : 1;
      const bObjective = strategicTargets.has(b) ? 0 : 1;
      if (aObjective !== bObjective) return aObjective - bObjective;
      const distance = distanceToStrategic(a) - distanceToStrategic(b);
      if (distance) return distance;
    }
    return (
      pressureHash(state, a, phaseTurn) - pressureHash(state, b, phaseTurn) ||
      a.localeCompare(b)
    );
  })[0];
};

const attackIsViable = (
  state: GameState,
  enemy: EnemySquad,
  target: SectorId,
  excluded = new Set<string>(),
): boolean => {
  const sector = state.sectors.find((item) => item.id === target);
  const defenders = state.squads.filter(
    (squad) => squad.sector === target && squad.strength > 0,
  );
  if (!sector || !defenders.length) return true;
  // Viability is intentionally local: only the actor that emits the attack
  // contributes power. Other live squads must spend their own legal slot to
  // move, guard, or attack; they are never virtual support.
  const enemyPower = enemy.strength * terrainPower[sector.terrain];
  const playerPower = defenders.reduce(
    (sum, squad) => sum + squad.strength * terrainPower[sector.terrain],
    0,
  );
  return enemyPower >= playerPower * 0.5;
};
const viableEnemyIntent = (
  state: GameState,
  intent: EnemyIntent,
  excluded = new Set<string>(),
): boolean => {
  if (intent.kind !== "attack") return true;
  const enemy = state.enemySquads.find((item) => item.id === intent.squadId);
  return Boolean(
    enemy &&
    intent.target &&
    attackIsViable(state, enemy, intent.target, excluded),
  );
};

const nextLegalStep = (
  state: GameState,
  start: SectorId,
  destination: SectorId,
  enemyId: string,
): SectorId | undefined => {
  if (start === destination) return undefined;
  const queue: Array<{ sector: SectorId; path: SectorId[] }> = [
    { sector: start, path: [] },
  ];
  const seen = new Set<SectorId>([start]);
  while (queue.length) {
    const current = queue.shift()!;
    const sector = state.sectors.find((item) => item.id === current.sector);
    for (const link of sector?.links ?? []) {
      if (seen.has(link)) continue;
      const linked = state.sectors.find((item) => item.id === link);
      if (!linked || linked.owner === "enemy") continue;
      if (
        state.enemySquads.some((other) => other.id !== enemyId && other.sector === link) ||
        state.squads.some((squad) => squad.sector === link)
      )
        continue;
      if (link === destination) return current.path[0] ?? link;
      seen.add(link);
      queue.push({ sector: link, path: [...current.path, link] });
    }
  }
  return undefined;
};

const legalCounterIntent = (
  state: GameState,
  excluded = new Set<string>(),
): EnemyIntent | undefined => {
  // Counterdeployment is based only on the remembered visible observation.
  // Current player positions at the remembered destination are intentionally
  // not consulted; only local adjacent attack viability is allowed below.
  const rememberedBucket = recentAdaptiveBuckets(state)
    .filter((bucket) => bucket.observations.length > 0)
    .at(-1);
  const remembered = rememberedBucket ? committedObservation(rememberedBucket) : undefined;
  if (!remembered) return undefined;
  const destination = observationDestination(remembered);
  const desiredClass = Object.entries(counterClass).find(
    ([, victim]) => victim === remembered.class,
  )?.[0] as UnitClass | undefined;
  if (!desiredClass) return undefined;
  const enemies = state.enemySquads
    .filter((enemy) => {
      if (
        !Number.isFinite(enemy.strength) ||
        enemy.strength <= 0 ||
        excluded.has(enemy.id)
      )
        return false;
      const guardingObjective = state.objectives.some(
        (objective) => objective.sector === enemy.sector && !objective.controlled,
      );
      return enemy.sector !== state.hq.enemy && !guardingObjective;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const enemy of enemies) {
      if (enemy.class !== desiredClass) continue;
      const current = state.sectors.find((sector) => sector.id === enemy.sector);
      if (current?.links.includes(destination) && attackIsViable(state, enemy, destination, excluded))
        return {
          squadId: enemy.id,
          kind: "attack",
          from: enemy.sector,
          to: enemy.sector,
          target: destination,
        };
      const step = nextLegalStep(state, enemy.sector, destination, enemy.id);
      if (step)
        return {
          squadId: enemy.id,
          kind: "move",
          from: enemy.sector,
          to: step,
        };
  }
  return undefined;
};

const rememberedGuardTarget = (
  state: GameState,
  enemy: EnemySquad,
  targets: SectorId[],
  excluded: Set<string>,
): SectorId | undefined => {
  if (
    !state.objectives.some(
      (objective) => objective.sector === enemy.sector && !objective.controlled,
    ) && enemy.sector !== state.hq.enemy
  )
    return undefined;
  const rememberedBucket = recentAdaptiveBuckets(state)
    .filter((bucket) => bucket.observations.length > 0)
    .at(-1);
  const remembered = rememberedBucket
    ? committedObservation(rememberedBucket)
    : undefined;
  if (!remembered) return undefined;
  const desiredClass = Object.entries(counterClass).find(
    ([, victim]) => victim === remembered.class,
  )?.[0] as UnitClass | undefined;
  if (enemy.class !== desiredClass) return undefined;
  return targets.find(
    (target) =>
      target === observationDestination(remembered) &&
      attackIsViable(state, enemy, target, excluded),
  );
};

const intentForEnemy = (
  state: GameState,
  enemy: EnemySquad,
  phaseTurn = state.turn,
  excluded = new Set<string>(),
): EnemyIntent | undefined => {
  const current = state.sectors.find((sector) => sector.id === enemy.sector);
  const recentMoves = state.enemyHistory
    .filter(
      (item) =>
        item.squadId === enemy.id &&
        item.kind === "move" &&
        item.from !== item.to,
    )
    .slice(-4);
  if (enemy.sector === state.hq.enemy) {
    const hqCounterTarget = (current?.links ?? [])
      .filter((target) =>
        state.squads.some((squad) => squad.sector === target && squad.strength > 0),
      )
      .sort()[0];
    if (
      hqCounterTarget &&
      attackIsViable(state, enemy, hqCounterTarget, excluded)
    )
      return {
        squadId: enemy.id,
        kind: "attack",
        from: enemy.sector,
        to: enemy.sector,
        target: hqCounterTarget,
      };
    return {
      squadId: enemy.id,
      kind: "hold",
      from: enemy.sector,
      to: enemy.sector,
    };
  }
  const hqAssault =
    enemy.sector !== state.hq.player &&
    current?.links.includes(state.hq.player) &&
    state.squads.some((squad) => squad.sector === state.hq.player);
  if (hqAssault && attackIsViable(state, enemy, state.hq.player, excluded))
    return {
      squadId: enemy.id,
      kind: "attack",
      from: enemy.sector,
      to: enemy.sector,
      target: state.hq.player,
    };
  const occupiedPlayerTargets = [...(current?.links ?? [])].filter((target) => {
    const sector = state.sectors.find((item) => item.id === target);
    const occupied = state.squads.some((squad) => squad.sector === target);
    const relay = state.objectives.some(
      (objective) => objective.sector === target,
    );
    return occupied && (sector?.owner === "player" || relay);
  });
  const occupiedPlayerTarget = choosePressureTarget(
    state,
    occupiedPlayerTargets.filter((target) =>
      attackIsViable(state, enemy, target, excluded),
    ),
    phaseTurn,
  );
  const rememberedTarget = rememberedGuardTarget(
    state,
    enemy,
    occupiedPlayerTargets,
    excluded,
  );
  if (rememberedTarget)
    return {
      squadId: enemy.id,
      kind: "attack",
      from: enemy.sector,
      to: enemy.sector,
      target: rememberedTarget,
    };
  if (occupiedPlayerTarget)
    return {
      squadId: enemy.id,
      kind: "attack",
      from: enemy.sector,
      to: enemy.sector,
      target: occupiedPlayerTarget,
    };
  // A live guard on an approach contests a captured relay before stale HQ
  // pursuit. This uses only a real adjacent tile and a finite actor.
  const capturedRelay = (current?.links ?? []).find((target) => {
    const sector = state.sectors.find((item) => item.id === target);
    return (
      sector?.owner === "player" &&
      state.objectives.some(
        (objective) => objective.sector === target && objective.controlled,
      )
    );
  });
  if (capturedRelay) {
    const wardDefender = state.squads.some(
      (squad) => squad.sector === capturedRelay && squad.strength > 0,
    );
    if (wardDefender && attackIsViable(state, enemy, capturedRelay, excluded)) {
      return {
        squadId: enemy.id,
        kind: "attack",
        from: enemy.sector,
        to: enemy.sector,
        target: capturedRelay,
      };
    }
    const vacatedRelayImmediatelyThreatened =
      state.objectives.some(
        (objective) => objective.sector === enemy.sector && !objective.controlled,
      ) &&
      state.squads.some((squad) => {
        if (squad.strength <= 0) return false;
        const squadSector = state.sectors.find((sector) => sector.id === squad.sector);
        return squadSector?.links.includes(enemy.sector);
      });
    if (
      !wardDefender &&
      !vacatedRelayImmediatelyThreatened &&
      !state.enemySquads.some(
        (other) => other.id !== enemy.id && other.sector === capturedRelay,
      )
    ) {
      return {
        squadId: enemy.id,
        kind: "move",
        from: enemy.sector,
        to: capturedRelay,
      };
    }
  }
  const relayHasImmediateWardThreat =
    state.objectives.some(
      (objective) => objective.sector === enemy.sector && !objective.controlled,
    ) &&
    state.squads.some((squad) => {
      if (squad.strength <= 0) return false;
      const squadSector = state.sectors.find((sector) => sector.id === squad.sector);
      return squadSector?.links.includes(enemy.sector);
    });
  if (relayHasImmediateWardThreat && !occupiedPlayerTarget)
    return {
      squadId: enemy.id,
      kind: "hold",
      from: enemy.sector,
      to: enemy.sector,
    };
  const guardsRelay = state.objectives.some(
    (objective) => objective.sector === enemy.sector && !objective.controlled,
  );
  const exposedSupplyApproach = (current?.links ?? []).find((target) => {
    const sector = state.sectors.find((item) => item.id === target);
    return (
      sector?.owner === "player" &&
      !state.objectives.some((objective) => objective.sector === target) &&
      !state.enemySquads.some(
        (other) => other.id !== enemy.id && other.sector === target,
      )
    );
  });
  if (exposedSupplyApproach) {
    const wardDefender = state.squads.some(
      (squad) => squad.sector === exposedSupplyApproach && squad.strength > 0,
    );
    if (
      wardDefender &&
      attackIsViable(state, enemy, exposedSupplyApproach, excluded)
    ) {
      return {
        squadId: enemy.id,
        kind: "attack",
        from: enemy.sector,
        to: enemy.sector,
        target: exposedSupplyApproach,
      };
    }
    if (!wardDefender)
      return {
        squadId: enemy.id,
        kind: "move",
        from: enemy.sector,
        to: exposedSupplyApproach,
      };
  }
  const depot = state.sectors
    .filter(
      (sector) =>
        (sector.id === "sector-2" || sector.id === "sector-10") &&
        sector.owner === "player" &&
        supplied(state, sector.id),
    )
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  if (guardsRelay && !depot)
    return {
      squadId: enemy.id,
      kind: "hold",
      from: enemy.sector,
      to: enemy.sector,
    };
  if (depot) {
    const depotOccupied = state.squads.some(
      (squad) => squad.sector === depot.id && squad.strength > 0,
    );
    if (
      depotOccupied &&
      (current?.links ?? []).includes(depot.id) &&
      attackIsViable(state, enemy, depot.id, excluded)
    ) {
      return {
        squadId: enemy.id,
        kind: "attack",
        from: enemy.sector,
        to: enemy.sector,
        target: depot.id,
      };
    }
    if (depotOccupied && (current?.links ?? []).includes(depot.id))
      return {
        squadId: enemy.id,
        kind: "hold",
        from: enemy.sector,
        to: enemy.sector,
      };
    const step = nextLegalStep(state, enemy.sector, depot.id, enemy.id);
    if (step)
      return { squadId: enemy.id, kind: "move", from: enemy.sector, to: step };
  }
  const destinations = [...(current?.links ?? [])].filter((target) => {
    const sector = state.sectors.find((item) => item.id === target);
    const isUndefendedHq =
      target === state.hq.player &&
      !state.squads.some((squad) => squad.sector === target);
    return (
      sector &&
      sector.owner !== "enemy" &&
      !state.enemySquads.some(
        (other) => other.id !== enemy.id && other.sector === target,
      ) &&
      (isUndefendedHq || !state.squads.some((squad) => squad.sector === target))
    );
  });
  const destination = choosePressureTarget(
    state,
    destinations,
    phaseTurn,
    true,
    false,
  );
  return destination
    ? { squadId: enemy.id, kind: "move", from: enemy.sector, to: destination }
    : undefined;
};
const distanceBetween = (
  state: GameState,
  start: SectorId,
  destination: SectorId,
): number => {
  if (start === destination) return 0;
  const seen = new Set<SectorId>([start]);
  const queue: Array<[SectorId, number]> = [[start, 0]];
  while (queue.length) {
    const [current, distance] = queue.shift()!;
    const sector = state.sectors.find((item) => item.id === current);
    for (const link of sector?.links ?? []) {
      if (link === destination) return distance + 1;
      if (!seen.has(link)) {
        seen.add(link);
        queue.push([link, distance + 1]);
      }
    }
  }
  return Number.MAX_SAFE_INTEGER;
};
const intentToward = (
  state: GameState,
  target: StrategicTarget,
  phaseTurn: number,
  excluded = new Set<string>(),
): EnemyIntent | undefined => {
  const enemy = state.enemySquads.find((item) => item.id === target.squadId);
  if (!enemy) return undefined;
  const destinationSector = state.sectors.find(
    (item) => item.id === target.destination,
  );
  if (
    !destinationSector ||
    (target.destination !== state.hq.player &&
      destinationSector.owner === "enemy")
  )
    return undefined;
  const current = state.sectors.find((item) => item.id === enemy.sector);
  if (!current || enemy.sector === target.destination) return undefined;
  const legalDistance = (start: SectorId): number => {
    if (start === target.destination) return 0;
    const seen = new Set<SectorId>([start]);
    const queue: Array<[SectorId, number]> = [[start, 0]];
    while (queue.length) {
      const [sectorId, distance] = queue.shift()!;
      const sector = state.sectors.find((item) => item.id === sectorId);
      for (const link of sector?.links ?? []) {
        if (link === target.destination) return distance + 1;
        if (seen.has(link)) continue;
        const linked = state.sectors.find((item) => item.id === link);
        const occupied = state.enemySquads.some(
          (other) => other.id !== enemy.id && other.sector === link,
        );
        if (
          !linked ||
          (linked.owner === "enemy" && link !== target.destination) ||
          occupied
        )
          continue;
        seen.add(link);
        queue.push([link, distance + 1]);
      }
    }
    return Number.MAX_SAFE_INTEGER;
  };
  const currentDistance = legalDistance(current.id);
  if (currentDistance === Number.MAX_SAFE_INTEGER) return undefined;
  if (current.links.includes(target.destination)) {
    const occupied = state.squads.some(
      (squad) => squad.sector === target.destination,
    );
    const relay = state.objectives.some(
      (objective) => objective.sector === target.destination,
    );
    if (
      occupied &&
      (destinationSector.owner === "player" || relay) &&
      attackIsViable(state, enemy, target.destination, excluded)
    )
      return {
        squadId: enemy.id,
        kind: "attack",
        from: enemy.sector,
        to: enemy.sector,
        target: target.destination,
      };
  }
  const blockedForward = current.links.filter((next) => {
    const sector = state.sectors.find((item) => item.id === next);
    return (
      sector &&
      distanceBetween(state, next, target.destination) <
        distanceBetween(state, current.id, target.destination) &&
      state.squads.some((squad) => squad.sector === next)
    );
  })[0];
  if (blockedForward && attackIsViable(state, enemy, blockedForward, excluded))
    return {
      squadId: enemy.id,
      kind: "attack",
      from: enemy.sector,
      to: enemy.sector,
      target: blockedForward,
    };
  const steps = current.links.filter((next) => {
    const sector = state.sectors.find((item) => item.id === next);
    return (
      sector &&
      sector.owner !== "enemy" &&
      !state.enemySquads.some(
        (other) => other.id !== enemy.id && other.sector === next,
      ) &&
      !state.squads.some((squad) => squad.sector === next)
    );
  });
  const step = steps
    .filter((step) => legalDistance(step) < currentDistance)
    .sort(
      (a, b) =>
        legalDistance(a) - legalDistance(b) ||
        pressureHash(state, `${target.squadId}:${a}`, phaseTurn) -
          pressureHash(state, `${target.squadId}:${b}`, phaseTurn) ||
        a.localeCompare(b),
    )[0];
  return step
    ? { squadId: enemy.id, kind: "move", from: enemy.sector, to: step }
    : undefined;
};
const destinationForIntent = (
  state: GameState,
  intent: EnemyIntent,
): SectorId | undefined => {
  if (state.strategicTarget?.squadId === intent.squadId) {
    const pursuing = intentToward(state, state.strategicTarget, state.turn);
    if (pursuing?.kind === intent.kind)
      return state.strategicTarget.destination;
    if (intent.kind === "move") return intent.to;
    if (intent.kind === "attack") return intent.target;
  }
  if (intent.kind === "attack") return intent.target;
  if (intent.kind !== "move") return undefined;
  // Strategic identity is the objective, not the one-hop step. HQ is primary;
  // if it is no longer relevant, retain a live uncaptured relay objective.
  if (
    state.sectors.find((sector) => sector.id === state.hq.player)?.owner !==
    "enemy"
  )
    return state.hq.player;
  return state.objectives.find((objective) => !objective.controlled)?.sector;
};
const relevantStrategicTarget = (
  state: GameState,
  target: StrategicTarget | undefined,
): boolean => {
  if (!target) return false;
  const enemy = state.enemySquads.find((item) => item.id === target.squadId);
  const destination = state.sectors.find(
    (sector) => sector.id === target.destination,
  );
  return Boolean(
    enemy &&
    destination &&
    (target.destination === state.hq.player || destination.owner !== "enemy"),
  );
};
export const decideEnemyIntent = (
  state: GameState,
  phaseTurn = state.turn,
  excluded = new Set<string>(),
): EnemyIntent | undefined => {
  if (state.terminal !== "active") return undefined;
  const enemies = [...state.enemySquads].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const intents = enemies
    .filter((enemy) => !excluded.has(enemy.id))
    .map((enemy) => intentForEnemy(state, enemy, phaseTurn, excluded))
    .filter((intent): intent is EnemyIntent => Boolean(intent));
  if (!intents.length) return undefined;
  const hq = intents.filter(
    (intent) => intent.kind === "attack" && intent.target === state.hq.player,
  );
  const relay = intents.filter(
    (intent) =>
      intent.kind === "attack" &&
      state.objectives.some((objective) => objective.sector === intent.target),
  );
  const tactical = hq.length ? hq : relay;
  if (tactical.length)
    return tactical
      .slice()
      .sort(
        (a, b) =>
          pressureHash(state, `${a.squadId}:${a.target}`, phaseTurn) -
            pressureHash(state, `${b.squadId}:${b.target}`, phaseTurn) ||
          a.squadId.localeCompare(b.squadId),
      )[0];
  if (state.strategicTarget) {
    const defender = intents.find(
      (intent) => intent.squadId === state.strategicTarget?.squadId,
    );
    const defenderEnemy = enemies.find(
      (enemy) => enemy.id === state.strategicTarget?.squadId,
    );
    const defenderRelay =
      defenderEnemy &&
      state.objectives.some(
        (objective) =>
          objective.sector === defenderEnemy.sector && !objective.controlled,
    );
    if (defender?.kind === "hold" && defenderRelay) return defender;
    const defenderMoveRelay =
      defender?.kind === "move" &&
      state.objectives.some(
        (objective) =>
          objective.sector === defender.to &&
          state.sectors.find((sector) => sector.id === objective.sector)
            ?.owner === "player",
      );
    const defenderMoveSupply =
      defender?.kind === "move" &&
      state.sectors.find((sector) => sector.id === defender.to)?.owner ===
        "player";
    const defenderAttackSupply =
      defender?.kind === "attack" &&
      defender.target &&
      state.sectors.find((sector) => sector.id === defender.target)?.owner ===
        "player";
    if (defenderAttackSupply && viableEnemyIntent(state, defender, excluded))
      return defender;
    if (defenderMoveRelay || defenderMoveSupply) return defender;
    const pursuing = excluded.has(state.strategicTarget.squadId)
      ? undefined
      : intentToward(state, state.strategicTarget, phaseTurn, excluded);
    if (pursuing && viableEnemyIntent(state, pursuing, excluded))
      return pursuing;
    const targetEnemy = enemies.find(
      (enemy) => enemy.id === state.strategicTarget?.squadId,
    );
    if (targetEnemy && !excluded.has(targetEnemy.id))
      return {
        squadId: targetEnemy.id,
        kind: "hold",
        from: targetEnemy.sector,
        to: targetEnemy.sector,
      };
  }
  const strategicCounter = adaptiveStyle(state) !== "UNSET"
    ? legalCounterIntent(state, excluded)
    : undefined;
  if (strategicCounter) return strategicCounter;
  const tier = intents.filter((intent) => intent.kind !== "hold");
  const candidates = tier.length ? tier : intents;
  const style = adaptiveStyle(state);
  return candidates
    .slice()
    .sort(
      (a, b) =>
        (style === "AGGRESSIVE"
          ? Number(b.kind === "attack") - Number(a.kind === "attack")
          : style === "DEFENSIVE"
            ? Number(b.kind === "move") - Number(a.kind === "move")
            : 0) ||
        pressureHash(
          state,
          `${a.squadId}:${a.to ?? a.target ?? a.from}`,
          phaseTurn,
        ) -
          pressureHash(
            state,
            `${b.squadId}:${b.to ?? b.target ?? b.from}`,
            phaseTurn,
          ) || a.squadId.localeCompare(b.squadId),
    )[0];
};
/** Return the deterministic hostile sequence for a phase. The committed phase
 * gives every currently live hostile squad one slot; an explicit budget caps
 * that set for forecast/test callers. */
export const decideEnemyIntents = (
  state: GameState,
  actionBudget?: number,
): EnemyIntent[] => {
  const limit =
    actionBudget === undefined || actionBudget <= 0
      ? state.enemySquads.filter((enemy) => enemy.strength > 0).length
      : actionBudget;
  let remaining = state;
  const acted = new Set<string>();
  const intents: EnemyIntent[] = [];
  for (let index = 0; index < limit; index += 1) {
    const intent = decideEnemyIntent(remaining, state.turn, acted);
    if (!intent) break;
    intents.push(intent);
    const simulation = {
      ...remaining,
      researchLevels: { ...remaining.researchLevels, Signals: 0 },
    };
    remaining = resolveEnemyTurnOnce(simulation, acted).nextState;
    acted.add(intent.squadId);
  }
  return intents;
};
const scoutRoutes = (state: GameState, phaseTurn = state.turn): string[] => {
  const selected = decideEnemyIntents(state).map(
    (intent) => [intent.squadId, intent] as const,
  );
  const bySquad = new Map(selected);
  return state.enemySquads.map((enemy) => {
    const acting = bySquad.get(enemy.id);
    const origin =
      state.sectors.find((sector) => sector.id === enemy.sector)?.name ??
      "unknown sector";
    if (!acting) return enemy.class + " garrison at " + origin + ": waits";
    if (acting.kind === "hold")
      return enemy.class + " garrison at " + origin + ": holds position";
    if (acting.kind === "attack")
      return (
        enemy.class +
        " garrison from " +
        origin +
        ": assaults " +
        (state.sectors.find((item) => item.id === acting.target)?.name ?? "HQ")
      );
    if (acting.kind === "move")
      return (
        enemy.class +
        " garrison from " +
        origin +
        ": advances to " +
        (state.sectors.find((item) => item.id === acting.to)?.name ??
          "unknown sector")
      );
    return enemy.class + " garrison at " + origin + ": holds position";
  });
};
export const advanceResearch = (
  state: GameState,
  branch: ResearchBranch,
): GameState => {
  if (state.terminal !== "active") error("Campaign is over");
  const level = state.researchLevels[branch];
  if (level >= 2) error(`${branch} is complete`);
  const income = calculateIncome(state);
  const threshold = researchIncomeThreshold(branch, level);
  if (!Object.values(income).some((value) => value >= threshold))
    error(`${branch} requires ${threshold} unit of owned HQ-connected income`);
  const cost = researchCost(branch, level);
  if (
    Object.keys(cost).some(
      (key) =>
        state.resources[key as keyof Resources] < cost[key as keyof Resources],
    )
  )
    error(`Not enough resources for ${branch}`);
  const next = clone(state);
  next.resources = {
    metal: next.resources.metal - cost.metal,
    energy: next.resources.energy - cost.energy,
    intelligence: next.resources.intelligence - cost.intelligence,
  };
  next.researchLevels[branch] += 1;
  next.research += 1;
  if (branch === "Logistics")
    next.supplyCapacity = 10 + next.researchLevels.Logistics * 2;
  if (branch === "Signals") {
    next.revealedEnemySquads = next.enemySquads.map((enemy) => enemy.id);
    if (next.researchLevels.Signals >= 2)
      next.scoutedEnemyRoutes = scoutRoutes(next, next.turn + 1);
  }
  return next;
};
export const terminalState = (state: GameState): GameState => {
  const next = clone(state);
  const relaysSecured = next.objectives.every(
    (objective) => objective.controlled,
  );
  const enemyHqCaptured =
    next.sectors.find((sector) => sector.id === next.hq.enemy)?.owner ===
    "player";
  if (relaysSecured && enemyHqCaptured) {
    next.terminal = "victory";
    next.terminalReason = "All three relays secured and enemy HQ captured.";
  } else if (!next.squads.length) {
    next.terminal = "defeat";
    next.terminalReason = "No Ward squads remain.";
  } else if (
    next.sectors.find((sector) => sector.id === next.hq.player)?.owner ===
    "enemy"
  ) {
    next.terminal = "defeat";
    next.terminalReason = "Player HQ lost.";
  } else if (next.turn > 18) {
    next.terminal = "defeat";
    next.terminalReason = "Turn 18 reached without victory.";
  }
  return next;
};
export const validateOrders = (state: GameState, orders: Order[]): void => {
  if (state.terminal !== "active")
    error("Campaign is over; orders are blocked");
  const seen = new Set<string>();
  let attackEnergy = 0;
  let attackMetal = 0;
  let recoverMetal = 0;
  let recoverEnergy = 0;
  for (const order of orders) {
    if (seen.has(order.squadId))
      error(`Squad ${order.squadId} has more than one order`);
    seen.add(order.squadId);
    const squad = state.squads.find((item) => item.id === order.squadId);
    const currentSquad = squad ?? error(`Unknown squad ${order.squadId}`);
    if (currentSquad.strength <= 0)
      error(`Squad ${order.squadId} is destroyed`);
    if (!["hold", "recover", "move", "attack"].includes(order.type))
      error(`Invalid order for ${order.squadId}`);
    if (order.type === "move" || order.type === "attack") {
      if (!order.target) error(`${order.type} order requires a target`);
      const target =
        order.target ?? error(`${order.type} order requires a target`);
      const sector =
        state.sectors.find((item) => item.id === target) ??
        error(`Unknown target sector ${target}`);
      const currentSector = state.sectors.find(
        (item) => item.id === currentSquad.sector,
      );
      if (!currentSector?.links.includes(target))
        error(
          `Squad ${order.squadId} cannot reach ${target} from ${currentSquad.sector}`,
        );
      if (order.type === "attack" && sector.owner === "player")
        error(`Squad ${order.squadId} cannot attack an owned sector`);
      if (order.type === "move" && sector.owner === "enemy")
        error(
          `Squad ${order.squadId} cannot move into an enemy sector; attack it`,
        );
      if (state.enemySquads.some((enemy) => enemy.sector === target)) {
        if (order.type === "move")
          error(`Squad ${order.squadId} cannot move through an enemy squad`);
      }
    }
    if (
      order.type === "recover" &&
      (state.sectors.find((sector) => sector.id === currentSquad.sector)
        ?.owner !== "player" ||
        !supplied(state, currentSquad.sector))
    )
      error(`Squad ${order.squadId} cannot recover outside supplied territory`);
    if (order.type === "attack") {
      attackEnergy += ATTACK_ENERGY_COST;
      attackMetal += ATTACK_METAL_COST;
    }
    if (order.type === "recover") {
      recoverMetal += recoveryMetalCost(state);
      recoverEnergy += RECOVERY_ENERGY_COST;
    }
  }
  if (state.resources.energy < attackEnergy)
    error("Not enough energy to attack orders");
  if (state.resources.metal < attackMetal + recoverMetal)
    error("Not enough metal for attack/recovery orders");
  if (state.resources.metal < recoverMetal)
    error("Not enough metal to recover orders");
  if (state.resources.energy < attackEnergy + recoverEnergy)
    error("Not enough energy for attack/recovery orders");
};

export const resolveTurn = (
  state: GameState,
  playerOrders: Order[],
): { nextState: GameState; events: GameEvent[] } => {
  validateOrders(state, playerOrders);
  const nextState = clone(state);
  const events: GameEvent[] = [];
  const observations: AdaptiveObservation[] = playerOrders.flatMap((order) => {
    if (order.type !== "move" && order.type !== "attack") return [];
    const squad = state.squads.find((item) => item.id === order.squadId);
    if (
      !squad ||
      squad.strength <= 0 ||
      !state.enemySquads.some(
        (enemy) =>
          enemy.strength > 0 && adjacentOrSame(state, squad.sector, enemy.sector),
      )
    )
      return [];
    return [{ kind: order.type, class: squad.class, from: squad.sector, ...(order.type === "move" ? { to: order.target } : { target: order.target }) }];
  });
  for (const order of playerOrders) {
    const squad = nextState.squads.find((item) => item.id === order.squadId);
    if (!squad || squad.strength <= 0) continue;
    const from = squad.sector;
    if (order.type === "move") {
      squad.sector = order.target!;
      const destination = nextState.sectors.find(
        (sector) => sector.id === squad.sector,
      );
      if (destination?.owner === "neutral") destination.owner = "player";
    }
    if (order.type === "recover") {
      squad.strength = Math.min(
        10 + nextState.researchLevels.Logistics * 2,
        squad.strength + 2 + nextState.researchLevels.Logistics,
      );
      squad.fatigue = Math.max(
        0,
        squad.fatigue - 2 - nextState.researchLevels.Logistics,
      );
      nextState.resources.metal -= recoveryMetalCost(nextState);
      nextState.resources.energy -= RECOVERY_ENERGY_COST;
    }
    if (order.type === "attack") {
      nextState.resources.energy -= ATTACK_ENERGY_COST;
      nextState.resources.metal -= ATTACK_METAL_COST;
    }
    if (order.type === "hold") squad.fatigue = Math.max(0, squad.fatigue - 1);
    events.push({
      type: order.type,
      squadId: squad.id,
      from,
      to: squad.sector,
      target: order.target,
      message: `${squad.id} ${order.type}${order.target ? ` ${order.target}` : ""}`,
    });
  }
  nextState.squads.forEach((squad: Squad) => {
    if (!playerOrders.some((order) => order.squadId === squad.id))
      squad.fatigue = Math.min(10, squad.fatigue + 1);
  });
  nextState.objectives = nextState.objectives.map((objective: Objective) => ({
    ...objective,
    controlled:
      nextState.sectors.find((sector) => sector.id === objective.sector)
        ?.owner === "player",
  }));
  nextState.turn += 1;
  nextState.orderHistory = [...nextState.orderHistory, clone(playerOrders)];
  nextState.adaptiveHistory = appendAdaptiveBucket(nextState, { turn: state.turn, observations });
  return { nextState, events };
};

const counters = counterClass;
const battleRandom = (seed: number, target: SectorId, turn: number): number => {
  let value = (seed ^ turn ^ Number(target.slice(7))) >>> 0;
  value = (value * 1664525 + 1013904223) >>> 0;
  return (value % 11) - 5;
};
const retreatDestination = (state: GameState, squad: Squad): SectorId => {
  const current = state.sectors.find((sector) => sector.id === squad.sector);
  const occupiedByEnemy = new Set(
    state.enemySquads.map((enemy) => enemy.sector),
  );
  const valid = (sectorId: SectorId) =>
    state.sectors.find((sector) => sector.id === sectorId)?.owner ===
      "player" && !occupiedByEnemy.has(sectorId);
  return [...(current?.links ?? [])].sort().find(valid) ?? squad.sector;
};

/** Resolve only attack intents already recorded in GameEvent/orderHistory. */
export const resolveCombat = (
  state: GameState,
  events: GameEvent[],
): { nextState: GameState; reports: BattleReport[] } => {
  const nextState = clone(state);
  const attacks = events.filter(
    (event) => event.type === "attack" && event.target,
  );
  const targets = [...new Set(attacks.map((event) => event.target!))].sort();
  const reports: BattleReport[] = [];
  for (const target of targets) {
    const sector = nextState.sectors.find((item) => item.id === target)!;
    const enemyAttack = attacks.some((event) => event.faction === "enemy");
    const attackers = attacks
      .filter((event) => event.target === target)
      .map((event) =>
        enemyAttack
          ? nextState.enemySquads.find((squad) => squad.id === event.squadId)!
          : nextState.squads.find((squad) => squad.id === event.squadId)!,
      )
      .filter(Boolean);
    const defenders = enemyAttack
      ? nextState.squads.filter(
          (squad) => squad.sector === target && squad.strength > 0,
        )
      : nextState.enemySquads.filter(
          (squad) => squad.sector === target && squad.strength > 0,
        );
    const classAdvantages = attackers.flatMap((attacker) =>
      defenders
        .filter((defender) => counters[attacker.class] === defender.class)
        .map((defender) => `${attacker.class} counters ${defender.class}`),
    );
    const defenderCounters = defenders.flatMap((defender) =>
      attackers
        .filter((attacker) => counters[defender.class] === attacker.class)
        .map((attacker) => `${defender.class} counters ${attacker.class}`),
    );
    const fatiguePenalty = enemyAttack
      ? 0
      : attackers.reduce(
          (sum, squad) =>
            sum + ("fatigue" in squad ? (squad as Squad).fatigue : 0),
          0,
        );
    const variance = battleRandom(nextState.seed, target, nextState.turn);
    const terrainMultiplier = terrainPower[sector.terrain];
    const isEnemyHq = target === nextState.hq.enemy;
    const attackerFaction = enemyAttack ? "enemy" : "player";
    const defenderFaction = enemyAttack ? "player" : "enemy";
    const coordinatedPower =
      attackers.length > 1
        ? 1 + Math.min(0.3, (attackers.length - 1) * 0.15)
        : 1;
    const attackerPower =
      attackers.reduce(
        (sum, squad) =>
          sum +
          squad.strength *
            terrainMultiplier *
            (1 +
              defenders.filter(
                (defender) => counters[squad.class] === defender.class,
              ).length *
                (0.2 +
                  (enemyAttack ? 0 : nextState.researchLevels.Warfare * 0.05))),
        0,
      ) *
        coordinatedPower -
      fatiguePenalty +
      variance;
    const defenderFortification =
      defenderFaction === "player"
        ? nextState.researchLevels.Warfare * 0.05
        : 0;
    const defenderPower = defenders.reduce(
      (sum, squad) =>
        sum +
        squad.strength *
          terrainMultiplier *
          (1 +
            defenderFortification +
            attackers.filter(
              (attacker) => counters[squad.class] === attacker.class,
            ).length *
              0.2),
      0,
    );
    const undefended = defenders.length === 0;
    const attackerStrengthBefore = new Map(
      attackers.map((squad) => [squad.id, squad.strength]),
    );
    const defenderStrengthBefore = new Map(
      defenders.map((squad) => [squad.id, squad.strength]),
    );
    const winner = undefended
      ? attackerFaction
      : attackerPower > defenderPower
        ? attackerFaction
        : attackerPower < defenderPower
          ? defenderFaction
          : "draw";
    const casualties: BattleReport["casualties"] = [];
    const attackerWon = winner === attackerFaction;
    const defenderWon = winner === defenderFaction;
    if (!undefended && (attackerWon || winner === "draw"))
      for (const squad of defenders)
        casualties.push({
          squadId: squad.id,
          side: defenderFaction,
          strength: Math.min(
            squad.strength,
            Math.max(
              1,
              Math.ceil(attackerPower / Math.max(1, attackers.length * 4)),
            ),
          ),
        });
    if (defenders.length && attackerWon) {
      const ratio = defenderPower / Math.max(1, attackerPower + defenderPower);
      const terrainLoss = sector.terrain === "ridge" ? 1 : 0;
      for (const squad of attackers) {
        const loss = Math.min(3, Math.max(1, Math.ceil(ratio * 3) + terrainLoss));
        casualties.push({ squadId: squad.id, side: attackerFaction, strength: Math.min(squad.strength, loss) });
      }
    } else if (!undefended && (defenderWon || winner === "draw")) {
      const ratio = defenderPower / Math.max(1, attackerPower + defenderPower);
      for (const squad of attackers) {
        const loss = 2 + Math.min(2, Math.max(0, Math.ceil(ratio * 3) - 1));
        casualties.push({ squadId: squad.id, side: attackerFaction, strength: Math.min(squad.strength, loss) });
      }
      for (const squad of defenders) {
        const loss = Math.min(3, Math.max(1, Math.ceil((1 - ratio) * 2)));
        casualties.push({ squadId: squad.id, side: defenderFaction, strength: Math.min(squad.strength, loss) });
      }
    }
    for (const casualty of casualties) {
      const squad =
        casualty.side === "player"
          ? nextState.squads.find((item) => item.id === casualty.squadId)
          : nextState.enemySquads.find((item) => item.id === casualty.squadId);
      if (squad) squad.strength -= casualty.strength;
    }
    nextState.squads = nextState.squads.filter((squad) => squad.strength > 0);
    nextState.enemySquads = nextState.enemySquads.filter(
      (squad) => squad.strength > 0,
    );
    const retreat: BattleReport["retreat"] = [];
    if (
      (attackerWon || undefended) &&
      !enemyAttack &&
      nextState.enemySquads.some(
        (squad) => squad.sector === target && squad.strength > 0,
      ) === false
    ) {
      sector.owner = "player";
      for (const squad of attackers) {
        const live = nextState.squads.find((item) => item.id === squad.id);
        if (live) {
          live.sector = target;
          live.experience += 1;
          live.fatigue = Math.min(10, live.fatigue + 2);
        }
      }
    } else if (attackerWon && !enemyAttack && defenders.length) {
      // A winning chip against a defended sector still consumes tempo. Keep
      // the cost visible in the squad state and forecasts, but do not stack it
      // with the +2 capture cost above.
      for (const squad of attackers) {
        const live = nextState.squads.find((item) => item.id === squad.id);
        if (live) live.fatigue = Math.min(10, live.fatigue + 1);
      }
    } else if (
      (attackerWon || undefended) &&
      enemyAttack &&
      !nextState.squads.some(
        (squad) => squad.sector === target && squad.strength > 0,
      )
    ) {
      sector.owner = "enemy";
      for (const squad of attackers) {
        const live = nextState.enemySquads.find((item) => item.id === squad.id);
        if (live) live.sector = target;
      }
    } else if (defenderWon && !enemyAttack) {
      for (const squad of attackers) {
        const live = nextState.squads.find((item) => item.id === squad.id);
        if (live) {
          live.experience += 1;
          live.fatigue = Math.min(10, live.fatigue + 2);
          live.sector = retreatDestination(nextState, live);
          retreat.push({ squadId: live.id, to: live.sector });
        }
      }
    }
    const relayControlled = nextState.objectives.some(
      (objective) => objective.sector === target && sector.owner === "player",
    );
    const captured =
      (attackerWon || undefended) &&
      (enemyAttack
        ? !nextState.squads.some(
            (squad) => squad.sector === target && squad.strength > 0,
          )
        : !nextState.enemySquads.some(
            (squad) => squad.sector === target && squad.strength > 0,
          ));
    reports.push({
      target,
      terrain: sector.terrain,
      terrainMultiplier,
      attackers: attackers.map((squad) => ({
        squadId: squad.id,
        class: squad.class,
        strength: attackerStrengthBefore.get(squad.id)!,
        units: Math.max(0, squad.strength),
      })),
      defenders: defenders.map((squad) => ({
        squadId: squad.id,
        class: squad.class,
        strength: defenderStrengthBefore.get(squad.id)!,
        units: Math.max(0, squad.strength),
      })),
      classAdvantages,
      defenderCounters,
      fatiguePenalty,
      variance,
      attackerPower,
      defenderPower,
      winner,
      casualties,
      playerCasualties: casualties
        .filter((item) => item.side === "player")
        .reduce((sum, item) => sum + item.strength, 0),
      enemyCasualties: casualties
        .filter((item) => item.side === "enemy")
        .reduce((sum, item) => sum + item.strength, 0),
      retreat,
      captured,
      relayControlled,
    });
  }
  nextState.objectives = nextState.objectives.map((objective) => ({
    ...objective,
    controlled:
      nextState.sectors.find((sector) => sector.id === objective.sector)
        ?.owner === "player",
  }));
  if (reports.length)
    nextState.recentBattles = reports.map(
      (report) => `${report.target}:${report.winner}`,
    );
  if (nextState.researchLevels.Signals > 0)
    nextState.revealedEnemySquads = nextState.enemySquads.map(
      (enemy) => enemy.id,
    );
  if (nextState.researchLevels.Signals > 1)
    nextState.scoutedEnemyRoutes = scoutRoutes(nextState);
  if (reports.length > 0 && nextState.strategicTarget) {
    const target = nextState.strategicTarget;
    const targetEnemy = nextState.enemySquads.find(
      (enemy) => enemy.id === target.squadId,
    );
    const targetWasAttacked = attacks.some(
      (event) => event.squadId === target.squadId,
    );
    const objectiveWasFoughtOver = reports.some(
      (report) => report.target === target.destination,
    );
    const destination = nextState.sectors.find(
      (sector) => sector.id === target.destination,
    );
    if (
      !targetEnemy ||
      targetWasAttacked ||
      objectiveWasFoughtOver ||
      !destination ||
      (destination.id !== nextState.hq.player && destination.owner === "enemy")
    )
      nextState.strategicTarget = undefined;
  }
  return { nextState, reports };
};

/** Deterministic, visible enemy phase: one selected hostile squad executes one legal strategic pressure action. */
const resolveEnemyTurnOnce = (
  state: GameState,
  acted: Set<string> = new Set(),
): { nextState: GameState; events: GameEvent[]; reports: BattleReport[] } => {
  const nextState = clone(state);
  const events: GameEvent[] = [];
  const phaseActive = nextState.terminal === "active";
  if (nextState.strategicTarget) {
    const targetEnemy = nextState.enemySquads.find(
      (enemy) => enemy.id === nextState.strategicTarget?.squadId,
    );
    const destination = nextState.sectors.find(
      (sector) => sector.id === nextState.strategicTarget?.destination,
    );
    if (
      !targetEnemy ||
      !destination ||
      (destination.id !== nextState.hq.player && destination.owner === "enemy")
    )
      nextState.strategicTarget = undefined;
  }
  const intent = phaseActive
    ? decideEnemyIntent(nextState, nextState.turn, acted)
    : undefined;
  if (intent && acted.has(intent.squadId))
    return { nextState, events, reports: [] };
  const enemy =
    intent && nextState.enemySquads.find((item) => item.id === intent.squadId);
  if (intent) {
    nextState.enemyHistory = [...nextState.enemyHistory, clone(intent)];
    nextState.strategicIntent = clone(intent);
    const destination = destinationForIntent(nextState, intent);
    const heldTarget = nextState.strategicTarget;
    if (heldTarget?.squadId === intent.squadId) {
      if (!relevantStrategicTarget(nextState, heldTarget))
        nextState.strategicTarget = undefined;
    } else if (destination) {
      nextState.strategicTarget = { squadId: intent.squadId, destination };
    }
  }
  if (intent?.kind === "move" && enemy && intent.to) {
    const from = enemy.sector;
    enemy.sector = intent.to;
    const sector = nextState.sectors.find((item) => item.id === intent.to)!;
    if (sector.owner === "player") sector.owner = "enemy";
    nextState.objectives = nextState.objectives.map((objective) => ({
      ...objective,
      controlled:
        nextState.sectors.find((sector) => sector.id === objective.sector)
          ?.owner === "player",
    }));
    const destinationName =
      nextState.sectors.find((item) => item.id === intent.to)?.name ??
      intent.to;
    events.push({
      type: "move",
      squadId: enemy.id,
      from,
      to: intent.to,
      message: `${enemy.id} advances to ${intent.to} (${destinationName})`,
      faction: "enemy",
    });
  } else if (intent?.kind === "hold" && enemy) {
    events.push({
      type: "hold",
      squadId: enemy.id,
      from: enemy.sector,
      to: enemy.sector,
      message: `${enemy.id} holds at ${enemy.sector}`,
    });
  }
  nextState.objectives = nextState.objectives.map((objective) => ({
    ...objective,
    controlled:
      nextState.sectors.find((sector) => sector.id === objective.sector)
        ?.owner === "player",
  }));
  if (intent?.kind === "attack" && enemy && intent.target) {
    const targetName =
      nextState.sectors.find((sector) => sector.id === intent.target)?.name ??
      intent.target;
    events.push({
      type: "attack",
      faction: "enemy",
      squadId: enemy.id,
      from: enemy.sector,
      to: enemy.sector,
      target: intent.target,
      message: `${enemy.id} assaults ${targetName}`,
    });
  }
  if (!phaseActive) return { nextState, events: [], reports: [] };
  const combat = resolveCombat(nextState, events);
  const combatState = combat.nextState;
  return { nextState: combatState, events, reports: combat.reports };
};

/** Resolve one coherent phase. Every live hostile squad acts once by default;
 * explicit budgets are caps used by forecast/test callers. */
export const resolveEnemyTurn = (
  state: GameState,
  actionBudget?: number,
): { nextState: GameState; events: GameEvent[]; reports: BattleReport[] } => {
  if (state.terminal !== "active")
    return { nextState: state, events: [], reports: [] };
  let nextState = clone(state);
  const events: GameEvent[] = [];
  const reports: BattleReport[] = [];
  const acted = new Set<string>();
  const requestedSlots =
    actionBudget === undefined || actionBudget <= 0
      ? state.enemySquads.filter((enemy) => enemy.strength > 0).length
      : actionBudget;
  const slots = Math.min(
    requestedSlots,
    state.enemySquads.filter((enemy) => enemy.strength > 0).length,
  );
  for (
    let index = 0;
    index < slots && nextState.terminal === "active";
    index += 1
  ) {
    const phase = resolveEnemyTurnOnce(nextState, acted);
    nextState = phase.nextState;
    events.push(...phase.events);
    reports.push(...phase.reports);
    phase.events.forEach((event) => acted.add(event.squadId));
    if (!phase.events.length) break;
  }
  nextState.income = calculateIncome(nextState);
  nextState.resources = {
    metal: Math.min(99, nextState.resources.metal + nextState.income.metal),
    energy: Math.min(99, nextState.resources.energy + nextState.income.energy),
    intelligence: Math.min(
      99,
      nextState.resources.intelligence + nextState.income.intelligence,
    ),
  };
  const resolved = terminalState(nextState);
  if (resolved.researchLevels.Signals > 1)
    resolved.scoutedEnemyRoutes = scoutRoutes(resolved, resolved.turn + 1);
  return { nextState: resolved, events, reports };
};

// Kept for the original shell's small API.
export type Campaign = { day: number; supplies: number };
export const initialCampaign = (): Campaign => ({ day: 1, supplies: 3 });
export const advanceDay = (campaign: Campaign): Campaign => ({
  day: campaign.day + 1,
  supplies: Math.max(0, campaign.supplies - 1),
});
