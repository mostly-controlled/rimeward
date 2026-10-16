export type UnitClass = 'Sentinel' | 'Raider' | 'Recon' | 'Artillery'
export type Terrain = 'ice' | 'ridge' | 'tundra' | 'crater'
export type OrderType = 'hold' | 'recover' | 'move' | 'attack'

export type SectorId = `sector-${number}`
export type Resources = { metal: number; energy: number; intelligence: number }
export type Sector = { id: SectorId; name: string; terrain: Terrain; links: SectorId[]; owner: 'player' | 'enemy' | 'neutral' }
export type Squad = { id: string; class: UnitClass; strength: number; fatigue: number; home: SectorId; sector: SectorId; experience: number; upgrades: string[] }
export type EnemySquad = { id: string; strength: number; sector: SectorId; class: UnitClass }
export type Objective = { id: string; sector: SectorId; controlled: boolean }
export type GameState = {
  seed: number; turn: number; sectors: Sector[]; objectives: Objective[]; hq: { player: SectorId; enemy: SectorId }
  squads: Squad[]; enemySquads: EnemySquad[]; resources: Resources; research: number
  recentBattles: string[]; orderHistory: Order[][]
}
export type Order = { squadId: string; type: OrderType; target?: SectorId }
export type GameEvent = { type: 'hold' | 'recover' | 'move' | 'attack'; squadId: string; from: SectorId; to: SectorId; message: string }

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
  const sectors = names.map((name, i): Sector => ({ id: id(i), name, terrain: terrains[i % terrains.length], links: [id((i + 1) % 12), id((i + 11) % 12)], owner: i === 0 ? 'player' : i === 6 ? 'enemy' : 'neutral' }))
  // Add fixed cross-links so the map is hex-like while remaining fully deterministic.
  for (const [a, b] of [[1, 5], [3, 8], [7, 10]] as const) { sectors[a].links.push(id(b)); sectors[b].links.push(id(a)) }
  const objectiveIndexes = [3, 6, 9]
  const squads = classes.concat('Sentinel').map((unitClass, i): Squad => ({ id: `squad-${i + 1}`, class: unitClass, strength: 10, fatigue: 0, home: id(0), sector: id(0), experience: 0, upgrades: [] }))
  const enemySquads = [0, 1, 2].map((i): EnemySquad => ({ id: `enemy-${i + 1}`, class: classes[Math.floor(random() * classes.length)], strength: 6 + Math.floor(random() * 5), sector: id([6, 8, 10][i]) }))
  return { seed: seed >>> 0, turn: 1, sectors, objectives: objectiveIndexes.map((n, i) => ({ id: `relay-${i + 1}`, sector: id(n), controlled: false })), hq: { player: id(0), enemy: id(6) }, squads, enemySquads, resources: { metal: 20, energy: 20, intelligence: 5 }, research: 0, recentBattles: [], orderHistory: [] }
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
export const validateOrders = (state: GameState, orders: Order[]): void => {
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
    if (order.type === 'recover') { squad.strength = Math.min(10, squad.strength + 1); squad.fatigue = Math.max(0, squad.fatigue - 2); nextState.resources.metal -= 1 }
    if (order.type === 'attack') { nextState.resources.energy -= 2; squad.sector = order.target!; squad.experience += 1; nextState.recentBattles = [...nextState.recentBattles, `${squad.id} attacked ${order.target}`].slice(-10) }
    if (order.type === 'hold') squad.fatigue = Math.max(0, squad.fatigue - 1)
    events.push({ type: order.type, squadId: squad.id, from, to: squad.sector, message: `${squad.id} ${order.type}${order.target ? ` ${order.target}` : ''}` })
  }
  nextState.squads.forEach((squad: Squad) => { if (!playerOrders.some(order => order.squadId === squad.id)) squad.fatigue = Math.min(10, squad.fatigue + 1) })
  nextState.objectives = nextState.objectives.map((objective: Objective) => ({ ...objective, controlled: nextState.sectors.find(sector => sector.id === objective.sector)?.owner === 'player' }))
  nextState.turn += 1
  nextState.orderHistory = [...nextState.orderHistory, clone(playerOrders)]
  return { nextState, events }
}

// Kept for the original shell's small API.
export type Campaign = { day: number; supplies: number }
export const initialCampaign = (): Campaign => ({ day: 1, supplies: 3 })
export const advanceDay = (campaign: Campaign): Campaign => ({ day: campaign.day + 1, supplies: Math.max(0, campaign.supplies - 1) })
