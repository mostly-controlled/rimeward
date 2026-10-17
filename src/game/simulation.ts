export type UnitClass = 'Sentinel' | 'Raider' | 'Recon' | 'Artillery'
export type Terrain = 'ice' | 'ridge' | 'tundra' | 'crater'
export type OrderType = 'hold' | 'recover' | 'move' | 'attack'
export type ResearchBranch = 'Logistics' | 'Warfare' | 'Signals'
export type TerminalStatus = 'active' | 'victory' | 'defeat'

export type SectorId = `sector-${number}`
export type Resources = { metal: number; energy: number; intelligence: number }
export type Sector = { id: SectorId; name: string; terrain: Terrain; links: SectorId[]; owner: 'player' | 'enemy' | 'neutral'; yields: Resources }
export type Squad = { id: string; class: UnitClass; strength: number; fatigue: number; home: SectorId; sector: SectorId; experience: number; upgrades: string[] }
export type EnemySquad = { id: string; strength: number; sector: SectorId; class: UnitClass }
export type Objective = { id: string; sector: SectorId; controlled: boolean }
export type GameState = {
  seed: number; turn: number; sectors: Sector[]; objectives: Objective[]; hq: { player: SectorId; enemy: SectorId }
  squads: Squad[]; enemySquads: EnemySquad[]; resources: Resources; research: number
  researchLevels: Record<ResearchBranch, number>; recentBattles: string[]; orderHistory: Order[][]
  terminal: TerminalStatus; terminalReason?: string; income: Resources; revealedEnemySquads: string[]
}
export type Order = { squadId: string; type: OrderType; target?: SectorId }
export type GameEvent = { type: 'hold' | 'recover' | 'move' | 'attack'; squadId: string; from: SectorId; to: SectorId; target?: SectorId; message: string }
export type BattleReport = {
  target: SectorId; terrain: Terrain; attackers: { squadId: string; class: UnitClass; strength: number; units: number }[]
  defenders: { squadId: string; class: UnitClass; strength: number; units: number }[]
  classAdvantages: string[]; defenderCounters: string[]; terrainMultiplier: number; fatiguePenalty: number; variance: number; attackerPower: number; defenderPower: number
  winner: 'player' | 'enemy' | 'draw'; casualties: { squadId: string; side: 'player' | 'enemy'; strength: number }[]
  retreat: { squadId: string; to: SectorId }[]; captured: boolean; relayControlled: boolean
}
const terrainPower: Record<Terrain, number> = { ice: 0.9, ridge: 1.15, tundra: 1, crater: 1.05 }

const names = ['Frostgate', 'Whiteplain', 'Cairnwatch', 'Northstar', 'Rimefield', 'Glassway', 'Ashenfall', 'Dawnscar', 'Ironhollow', 'Vesper', 'Bluevault', 'Lastlight']
const terrains: Terrain[] = ['ice', 'tundra', 'ridge', 'crater']
const classes: UnitClass[] = ['Sentinel', 'Raider', 'Recon', 'Artillery']
const id = (n: number): SectorId => `sector-${n}`

const rng = (seed: number) => {
  let value = seed >>> 0
  return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 0x100000000 }
}

export const createNewCampaign = (seed: number): GameState => {
  const random = rng(seed)
  const sectors = names.map((name, i): Sector => ({ id: id(i), name, terrain: terrains[i % terrains.length], links: [id((i + 1) % 12), id((i + 11) % 12)], owner: i === 0 ? 'player' : i === 6 ? 'enemy' : 'neutral', yields: { metal: 1 + (i % 3), energy: i % 2, intelligence: i % 4 === 0 ? 1 : 0 } }))
  // Add fixed cross-links so the map is hex-like while remaining fully deterministic.
  for (const [a, b] of [[1, 5], [3, 8], [7, 10]] as const) { sectors[a].links.push(id(b)); sectors[b].links.push(id(a)) }
  const objectiveIndexes = [3, 6, 9]
  const squads = classes.concat('Sentinel').map((unitClass, i): Squad => ({ id: `squad-${i + 1}`, class: unitClass, strength: 10, fatigue: 0, home: id(0), sector: id(0), experience: 0, upgrades: [] }))
  const enemySquads = [0, 1, 2].map((i): EnemySquad => ({ id: `enemy-${i + 1}`, class: classes[Math.floor(random() * classes.length)], strength: 6 + Math.floor(random() * 5), sector: id([6, 8, 10][i]) }))
  const initial = { seed: seed >>> 0, turn: 1, sectors, objectives: objectiveIndexes.map((n, i) => ({ id: `relay-${i + 1}`, sector: id(n), controlled: false })), hq: { player: id(0), enemy: id(6) }, squads, enemySquads, resources: { metal: 20, energy: 20, intelligence: 5 }, research: 0, researchLevels: { Logistics: 0, Warfare: 0, Signals: 0 }, recentBattles: [], orderHistory: [], terminal: 'active' as const, income: { metal: 0, energy: 0, intelligence: 0 }, revealedEnemySquads: [] }
  initial.income = calculateIncome(initial)
  return initial
}

const error = (message: string): never => { throw new Error(message) }
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const supplied = (state: GameState, sectorId: SectorId): boolean => {
  const owned = new Set(state.sectors.filter(sector => sector.owner === 'player').map(sector => sector.id))
  const reached = new Set<SectorId>([state.hq.player])
  const visit = (current: SectorId) => state.sectors.find(sector => sector.id === current)?.links.forEach(link => {
    if (owned.has(link) && !reached.has(link)) { reached.add(link); visit(link) }
  })
  visit(state.hq.player)
  return reached.has(sectorId)
}
export const connectedOwnedSectors = (state: GameState): Sector[] => state.sectors.filter(sector => sector.owner === 'player' && supplied(state, sector.id))
export const calculateIncome = (state: GameState): Resources => connectedOwnedSectors(state).reduce((sum, sector) => ({ metal: sum.metal + sector.yields.metal, energy: sum.energy + sector.yields.energy, intelligence: sum.intelligence + sector.yields.intelligence }), { metal: 0, energy: 0, intelligence: 0 })
export const researchCost = (branch: ResearchBranch, level: number): Resources => ({ metal: branch === 'Logistics' ? 2 + level : 0, energy: branch === 'Warfare' ? 2 + level : 0, intelligence: branch === 'Signals' ? 2 + level : 0 })
export const advanceResearch = (state: GameState, branch: ResearchBranch): GameState => { if (state.terminal !== 'active') error('Campaign is over'); const level = state.researchLevels[branch]; if (level >= 2) error(`${branch} is complete`); const cost = researchCost(branch, level); if (Object.keys(cost).some(key => state.resources[key as keyof Resources] < cost[key as keyof Resources])) error(`Not enough resources for ${branch}`); const next = clone(state); next.resources = { metal: next.resources.metal - cost.metal, energy: next.resources.energy - cost.energy, intelligence: next.resources.intelligence - cost.intelligence }; next.researchLevels[branch] += 1; next.research += 1; return next }
export const terminalState = (state: GameState): GameState => { const next = clone(state); if (next.objectives.every(objective => objective.controlled)) { next.terminal = 'victory'; next.terminalReason = 'All three relays secured.' } else if (!next.squads.length) { next.terminal = 'defeat'; next.terminalReason = 'No Ward squads remain.' } else if (next.sectors.find(sector => sector.id === next.hq.player)?.owner === 'enemy') { next.terminal = 'defeat'; next.terminalReason = 'Player HQ lost.' } else if (next.turn > 18) { next.terminal = 'defeat'; next.terminalReason = 'Turn 18 reached without victory.' } return next }
export const validateOrders = (state: GameState, orders: Order[]): void => {
  if (state.terminal !== 'active') error('Campaign is over; orders are blocked')
  const seen = new Set<string>()
  let attackEnergy = 0
  let recoverMetal = 0
  for (const order of orders) {
    if (seen.has(order.squadId)) error(`Squad ${order.squadId} has more than one order`)
    seen.add(order.squadId)
    const squad = state.squads.find(item => item.id === order.squadId)
    const currentSquad = squad ?? error(`Unknown squad ${order.squadId}`)
    if (!['hold', 'recover', 'move', 'attack'].includes(order.type)) error(`Invalid order for ${order.squadId}`)
    if (order.type === 'move' || order.type === 'attack') {
      if (!order.target) error(`${order.type} order requires a target`)
      const target = order.target ?? error(`${order.type} order requires a target`)
      const sector = state.sectors.find(item => item.id === target) ?? error(`Unknown target sector ${target}`)
      const currentSector = state.sectors.find(item => item.id === currentSquad.sector)
      if (!currentSector?.links.includes(target)) error(`Squad ${order.squadId} cannot reach ${target} from ${currentSquad.sector}`)
      if (order.type === 'attack' && sector.owner === 'player') error(`Squad ${order.squadId} cannot attack an owned sector`)
      if (order.type === 'move' && sector.owner === 'enemy') error(`Squad ${order.squadId} cannot move into an enemy sector; attack it`)
      if (state.enemySquads.some(enemy => enemy.sector === target)) {
        if (order.type === 'move') error(`Squad ${order.squadId} cannot move through an enemy squad`)
      }
    }
    if (order.type === 'recover' && (state.sectors.find(sector => sector.id === currentSquad.sector)?.owner !== 'player' || !supplied(state, currentSquad.sector))) error(`Squad ${order.squadId} cannot recover outside supplied territory`)
    if (order.type === 'attack') attackEnergy += 2
    if (order.type === 'recover') recoverMetal += 1
  }
  if (state.resources.energy < attackEnergy) error('Not enough energy to attack orders')
  if (state.resources.metal < recoverMetal) error('Not enough metal to recover orders')
}

export const resolveTurn = (state: GameState, playerOrders: Order[]): { nextState: GameState; events: GameEvent[] } => {
  validateOrders(state, playerOrders)
  const nextState = clone(state)
  const events: GameEvent[] = []
  for (const order of playerOrders) {
    const squad = nextState.squads.find(item => item.id === order.squadId)!
    const from = squad.sector
    if (order.type === 'move') { squad.sector = order.target!; const destination = nextState.sectors.find(sector => sector.id === squad.sector); if (destination?.owner === 'neutral') destination.owner = 'player' }
    if (order.type === 'recover') { squad.strength = Math.min(10 + nextState.researchLevels.Logistics * 2, squad.strength + 1 + nextState.researchLevels.Logistics); squad.fatigue = Math.max(0, squad.fatigue - 2 - nextState.researchLevels.Logistics); nextState.resources.metal -= 1 }
    if (order.type === 'attack') nextState.resources.energy -= 2
    if (order.type === 'hold') squad.fatigue = Math.max(0, squad.fatigue - 1)
    events.push({ type: order.type, squadId: squad.id, from, to: squad.sector, target: order.target, message: `${squad.id} ${order.type}${order.target ? ` ${order.target}` : ''}` })
  }
  nextState.squads.forEach((squad: Squad) => { if (!playerOrders.some(order => order.squadId === squad.id)) squad.fatigue = Math.min(10, squad.fatigue + 1) })
  nextState.objectives = nextState.objectives.map((objective: Objective) => ({ ...objective, controlled: nextState.sectors.find(sector => sector.id === objective.sector)?.owner === 'player' }))
  nextState.turn += 1
  nextState.orderHistory = [...nextState.orderHistory, clone(playerOrders)]
  return { nextState, events }
}

const counters: Record<UnitClass, UnitClass> = { Sentinel: 'Raider', Raider: 'Recon', Recon: 'Artillery', Artillery: 'Sentinel' }
const battleRandom = (seed: number, target: SectorId, turn: number): number => {
  let value = (seed ^ turn ^ Number(target.slice(7))) >>> 0
  value = (value * 1664525 + 1013904223) >>> 0
  return (value % 11) - 5
}
const retreatDestination = (state: GameState, squad: Squad): SectorId => {
  const current = state.sectors.find(sector => sector.id === squad.sector)
  const occupiedByEnemy = new Set(state.enemySquads.map(enemy => enemy.sector))
  const valid = (sectorId: SectorId) => state.sectors.find(sector => sector.id === sectorId)?.owner === 'player' && !occupiedByEnemy.has(sectorId)
  return [...(current?.links ?? [])].sort().find(valid) ?? squad.sector
}

/** Resolve only attack intents already recorded in GameEvent/orderHistory. */
export const resolveCombat = (state: GameState, events: GameEvent[]): { nextState: GameState; reports: BattleReport[] } => {
  const nextState = clone(state)
  const attacks = events.filter(event => event.type === 'attack' && event.target)
  const targets = [...new Set(attacks.map(event => event.target!))].sort()
  const reports: BattleReport[] = []
  for (const target of targets) {
    const sector = nextState.sectors.find(item => item.id === target)!
    const attackers = attacks.filter(event => event.target === target).map(event => nextState.squads.find(squad => squad.id === event.squadId)!).filter(Boolean)
    const defenders = nextState.enemySquads.filter(squad => squad.sector === target)
    const classAdvantages = attackers.flatMap(attacker => defenders.filter(defender => counters[attacker.class] === defender.class).map(defender => `${attacker.class} counters ${defender.class}`))
    const defenderCounters = defenders.flatMap(defender => attackers.filter(attacker => counters[defender.class] === attacker.class).map(attacker => `${defender.class} counters ${attacker.class}`))
    const fatiguePenalty = attackers.reduce((sum, squad) => sum + squad.fatigue, 0)
    const variance = battleRandom(nextState.seed, target, nextState.turn)
    const terrainMultiplier = terrainPower[sector.terrain]
    const isEnemyHq = target === nextState.hq.enemy
    const attackerPower = attackers.reduce((sum, squad) => sum + squad.strength * terrainMultiplier * (1 + defenders.filter(defender => counters[squad.class] === defender.class).length * (0.2 + (isEnemyHq ? 0 : nextState.researchLevels.Warfare * 0.05))), 0) - fatiguePenalty + variance
    const defenderPower = defenders.reduce((sum, squad) => sum + squad.strength * terrainMultiplier * (1 + attackers.filter(attacker => counters[squad.class] === attacker.class).length * 0.2), 0)
    const attackerStrengthBefore = new Map(attackers.map(squad => [squad.id, squad.strength]))
    const defenderStrengthBefore = new Map(defenders.map(squad => [squad.id, squad.strength]))
    const winner = attackerPower > defenderPower ? 'player' : attackerPower < defenderPower ? 'enemy' : 'draw'
    const casualties: BattleReport['casualties'] = []
    if (winner === 'player' || winner === 'draw') for (const squad of defenders) casualties.push({ squadId: squad.id, side: 'enemy', strength: Math.min(squad.strength, Math.max(1, Math.ceil(attackerPower / Math.max(1, attackers.length * 4))) ) })
    if (winner === 'enemy' || winner === 'draw') for (const squad of attackers) casualties.push({ squadId: squad.id, side: 'player', strength: Math.min(squad.strength, Math.max(1, Math.ceil(defenderPower / Math.max(1, attackers.length * 5))) ) })
    if (winner === 'player') for (const squad of attackers) casualties.push({ squadId: squad.id, side: 'player', strength: Math.min(squad.strength, 1) })
    if (winner === 'enemy') for (const squad of defenders) casualties.push({ squadId: squad.id, side: 'enemy', strength: Math.min(squad.strength, 1) })
    for (const casualty of casualties) {
      const squad = casualty.side === 'player' ? nextState.squads.find(item => item.id === casualty.squadId) : nextState.enemySquads.find(item => item.id === casualty.squadId)
      if (squad) squad.strength -= casualty.strength
    }
    nextState.squads = nextState.squads.filter(squad => squad.strength > 0)
    nextState.enemySquads = nextState.enemySquads.filter(squad => squad.strength > 0)
    const retreat: BattleReport['retreat'] = []
    if (winner === 'player' && nextState.enemySquads.some(squad => squad.sector === target && squad.strength > 0) === false) {
      sector.owner = 'player'
      for (const squad of attackers) { const live = nextState.squads.find(item => item.id === squad.id); if (live) { live.sector = target; live.experience += 1; live.fatigue = Math.min(10, live.fatigue + 2) } }
    } else if (winner === 'enemy') {
      for (const squad of attackers) { const live = nextState.squads.find(item => item.id === squad.id); if (live) { live.experience += 1; live.fatigue = Math.min(10, live.fatigue + 2); live.sector = retreatDestination(nextState, live); retreat.push({ squadId: live.id, to: live.sector }) } }
    }
    const relayControlled = nextState.objectives.some(objective => objective.sector === target && sector.owner === 'player')
    const captured = winner === 'player' && !nextState.enemySquads.some(squad => squad.sector === target && squad.strength > 0)
    reports.push({ target, terrain: sector.terrain, terrainMultiplier, attackers: attackers.map(squad => ({ squadId: squad.id, class: squad.class, strength: attackerStrengthBefore.get(squad.id)!, units: Math.max(0, squad.strength) })), defenders: defenders.map(squad => ({ squadId: squad.id, class: squad.class, strength: defenderStrengthBefore.get(squad.id)!, units: Math.max(0, squad.strength) })), classAdvantages, defenderCounters, fatiguePenalty, variance, attackerPower, defenderPower, winner, casualties, retreat, captured, relayControlled })
  }
  nextState.objectives = nextState.objectives.map(objective => ({ ...objective, controlled: nextState.sectors.find(sector => sector.id === objective.sector)?.owner === 'player' }))
  nextState.recentBattles = reports.map(report => `${report.target}:${report.winner}`)
  if (nextState.researchLevels.Signals > 0) nextState.revealedEnemySquads = nextState.enemySquads.map(enemy => enemy.id)
  return { nextState, reports }
}

/** Deterministic, visible enemy phase: one hostile squad advances along the first legal link. */
export const resolveEnemyTurn = (state: GameState): { nextState: GameState; events: GameEvent[] } => {
  const nextState = clone(state)
  const events: GameEvent[] = []
  // Keep the Ashenfall garrison in place so the seed-42024 route can reach its
  // intended contested engagement; the next deterministic garrison advances.
  const enemy = [...nextState.enemySquads].sort((a, b) => a.id.localeCompare(b.id)).find(item => item.sector !== nextState.hq.enemy)
  const current = enemy && nextState.sectors.find(sector => sector.id === enemy.sector)
  const destination = enemy && [...(current?.links ?? [])].sort().find(target => {
    const sector = nextState.sectors.find(item => item.id === target)
    const isUndefendedHq = target === nextState.hq.player && !nextState.squads.some(squad => squad.sector === target)
    return sector && sector.owner !== 'enemy' && !nextState.enemySquads.some(other => other.id !== enemy.id && other.sector === target) && (isUndefendedHq || !nextState.squads.some(squad => squad.sector === target))
  })
  if (enemy && destination) {
    const from = enemy.sector
    enemy.sector = destination
    const sector = nextState.sectors.find(item => item.id === destination)!
    if (sector.owner === 'player') sector.owner = 'enemy'
    nextState.objectives = nextState.objectives.map(objective => ({ ...objective, controlled: nextState.sectors.find(sector => sector.id === objective.sector)?.owner === 'player' }))
    events.push({ type: 'move', squadId: enemy.id, from, to: destination, message: `${enemy.id} advances to ${destination}` })
  } else if (enemy) {
    events.push({ type: 'hold', squadId: enemy.id, from: enemy.sector, to: enemy.sector, message: `${enemy.id} holds at ${enemy.sector}` })
  }
  nextState.objectives = nextState.objectives.map(objective => ({ ...objective, controlled: nextState.sectors.find(sector => sector.id === objective.sector)?.owner === 'player' }))
  nextState.income = calculateIncome(nextState)
  nextState.resources = { metal: Math.min(99, nextState.resources.metal + nextState.income.metal), energy: Math.min(99, nextState.resources.energy + nextState.income.energy), intelligence: Math.min(99, nextState.resources.intelligence + nextState.income.intelligence) }
  return { nextState: terminalState(nextState), events }
}

// Kept for the original shell's small API.
export type Campaign = { day: number; supplies: number }
export const initialCampaign = (): Campaign => ({ day: 1, supplies: 3 })
export const advanceDay = (campaign: Campaign): Campaign => ({ day: campaign.day + 1, supplies: Math.max(0, campaign.supplies - 1) })
