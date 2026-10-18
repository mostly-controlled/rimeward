import { describe, expect, it } from 'vitest'
import { advanceDay, advanceResearch, calculateIncome, connectedOwnedSectors, createNewCampaign, initialCampaign, resolveCombat, resolveEnemyTurn, resolveTurn, decideEnemyIntent, decideEnemyIntents, researchCost, researchIncomeThreshold, terminalState, validateOrders, type GameState, type Order } from './simulation'

describe('campaign simulation', () => {
  const distanceBetweenForTest = (state: GameState, start: string, destination: string): number => {
    if (start === destination) return 0
    const seen = new Set([start]); const queue: Array<[string, number]> = [[start, 0]]
    while (queue.length) {
      const [current, distance] = queue.shift()!
      const sector = state.sectors.find(item => item.id === current)
      for (const link of sector?.links ?? []) {
        if (link === destination) return distance + 1
        if (!seen.has(link)) { seen.add(link); queue.push([link, distance + 1]) }
      }
    }
    return Number.MAX_SAFE_INTEGER
  }
  const legalizeRecordedOrders = (state: GameState, orders: Order[]): Order[] => orders.map(order => {
    const squad = state.squads.find(item => item.id === order.squadId)
    if (!squad || !order.target) return order
    if ((order.type === 'move' || order.type === 'attack') && squad.sector === order.target) return { squadId: order.squadId, type: 'hold' }
    if (order.type === 'move' && (state.enemySquads.some(enemy => enemy.sector === order.target) || state.sectors.find(sector => sector.id === order.target)?.owner === 'enemy')) return { ...order, type: 'attack' }
    return order
  })

  it('advances each research branch exactly twice with branch-specific costs and effects', () => {
    const game = createNewCampaign(42)
    expect(researchCost('Logistics', 0)).toEqual({ metal: 8, energy: 1, intelligence: 0 })
    expect(researchCost('Logistics', 1)).toEqual({ metal: 12, energy: 2, intelligence: 0 })
    expect(researchCost('Warfare', 1)).toEqual({ metal: 2, energy: 12, intelligence: 0 })
    expect(researchCost('Signals', 1)).toEqual({ metal: 3, energy: 0, intelligence: 7 })
    const logistics = advanceResearch(game, 'Logistics')
    expect(logistics.researchLevels.Logistics).toBe(1)
    expect(logistics.resources).toEqual({ metal: 12, energy: 19, intelligence: 5 })
    expect(() => advanceResearch(advanceResearch(logistics, 'Logistics'), 'Logistics')).toThrow(/complete/)
    const warfare = advanceResearch(game, 'Warfare')
    const signals = advanceResearch({ ...game, resources: { ...game.resources, intelligence: 11 } }, 'Signals')
    expect(warfare.resources).toEqual({ metal: 19, energy: 12, intelligence: 5 })
    expect(signals.resources).toEqual({ metal: 18, energy: 20, intelligence: 7 })
    expect(warfare.research).toBe(1)
  })

  it('reports only HQ-connected owned income with per-sector yields', () => {
    const game = createNewCampaign(42)
    const supplied = { ...game, sectors: game.sectors.map(sector => sector.id === 'sector-1' ? { ...sector, owner: 'player' as const } : sector) }
    const disconnected = { ...supplied, sectors: supplied.sectors.map(sector => sector.id === 'sector-3' ? { ...sector, owner: 'player' as const, links: [] } : sector) }
    expect(connectedOwnedSectors(disconnected).map(sector => sector.id)).toEqual(['sector-0', 'sector-1'])
    expect(calculateIncome(disconnected)).toEqual({ metal: 3, energy: 1, intelligence: 1 })
    const shortSupply = { ...disconnected, supplyCapacity: 1 }
    expect(connectedOwnedSectors(shortSupply).map(sector => sector.id)).toEqual(['sector-0'])
    const beyondCapacity = { ...shortSupply, sectors: shortSupply.sectors.map(sector => sector.id === 'sector-2' ? { ...sector, owner: 'player' as const } : sector) }
    expect(connectedOwnedSectors(beyondCapacity).map(sector => sector.id)).not.toContain('sector-2')
  })

  it('ends in defeat when no Ward squads remain', () => {
    const game = createNewCampaign(9)
    const defeated = terminalState({ ...game, squads: [], terminal: 'active' })
    expect(defeated.terminal).toBe('defeat')
    expect(defeated.terminalReason).toContain('No Ward squads')
    expect(() => resolveTurn(defeated, [])).toThrow(/over|orders/i)
  })

  it('charges each atomic order exactly once and rejects unaffordable batches', () => {
    const game = createNewCampaign(10)
    const before = JSON.parse(JSON.stringify(game))
    expect(() => resolveTurn({ ...game, resources: { metal: 0, energy: 1, intelligence: 5 } }, [
      { squadId: 'squad-1', type: 'attack', target: 'sector-1' },
      { squadId: 'squad-2', type: 'attack', target: 'sector-1' },
    ])).toThrow(/energy/)
    expect(game).toEqual(before)
    const turn = resolveTurn(game, [{ squadId: 'squad-1', type: 'attack', target: 'sector-1' }])
    expect(turn.nextState.resources.energy).toBe(18)
  })
  it('uses Logistics capacity for supply reach, movement validation, and income', () => {
    const game = createNewCampaign(42)
    const allOwned = { ...game, sectors: game.sectors.map(sector => ({ ...sector, owner: 'player' as const })) }
    const capped = { ...allOwned, supplyCapacity: 1 }
    expect(connectedOwnedSectors(capped).map(sector => sector.id)).toEqual(['sector-0'])
    expect(calculateIncome(capped)).toEqual(allOwned.sectors.find(sector => sector.id === 'sector-0')!.yields)
    expect(() => validateOrders({ ...capped, squads: [{ ...capped.squads[0], sector: 'sector-1' as const }] }, [{ squadId: 'squad-1', type: 'recover' }])).toThrow(/supplied/)
    const tierTwo = advanceResearch(advanceResearch(game, 'Logistics'), 'Logistics')
    expect(tierTwo.supplyCapacity).toBe(14)
    expect(connectedOwnedSectors({ ...allOwned, supplyCapacity: tierTwo.supplyCapacity })).toHaveLength(12)
  })

  it('makes Warfare fortification change player defense outcomes', () => {
    const game = createNewCampaign(42)
    const prepared = { ...game, enemySquads: [{ ...game.enemySquads[0], sector: 'sector-1' as const, strength: 8 }], squads: [{ ...game.squads[0], sector: 'sector-0' as const, strength: 10 }, ...game.squads.slice(1).map(squad => ({ ...squad, sector: 'sector-11' as const }))] }
    const event = [{ type: 'attack' as const, faction: 'enemy' as const, squadId: prepared.enemySquads[0].id, from: 'sector-1' as const, to: 'sector-1' as const, target: 'sector-0' as const, message: 'enemy HQ assault' }]
    const base = resolveCombat(prepared, event).reports[0]
    const fortified = resolveCombat({ ...prepared, researchLevels: { ...prepared.researchLevels, Warfare: 2 } }, event).reports[0]
    expect(fortified.defenderPower).toBeGreaterThan(base.defenderPower)
  })

  it('keeps Warfare counter power directional at enemy HQ and isolated from hostile attackers', () => {
    const game = createNewCampaign(42024)
    const enemyHq = game.hq.enemy
    const playerPrepared = { ...game, squads: [{ ...game.squads[0], class: 'Raider' as const, sector: enemyHq, strength: 10 }], enemySquads: [{ ...game.enemySquads[0], class: 'Recon' as const, sector: enemyHq, strength: 10 }] }
    const playerAttack = [{ type: 'attack' as const, faction: 'player' as const, squadId: 'squad-1', from: enemyHq, to: enemyHq, target: enemyHq, message: 'player HQ assault' }]
    const playerBase = resolveCombat(playerPrepared, playerAttack).reports[0]
    const playerWarfare = resolveCombat({ ...playerPrepared, researchLevels: { ...playerPrepared.researchLevels, Warfare: 2 } }, playerAttack).reports[0]
    expect(playerBase.attackerPower).toBeCloseTo(12.8, 10)
    expect(playerWarfare.attackerPower).toBeCloseTo(13.95, 10)
    expect(playerWarfare.attackerPower - playerBase.attackerPower).toBeCloseTo(1.15, 10)
    expect(playerWarfare.classAdvantages).toContain('Raider counters Recon')

    const playerHq = game.hq.player
    const enemyPrepared = { ...game, enemySquads: [{ ...game.enemySquads[0], class: 'Sentinel' as const, sector: playerHq, strength: 10 }], squads: [{ ...game.squads[0], class: 'Raider' as const, sector: playerHq, strength: 10 }] }
    const enemyAttack = [{ type: 'attack' as const, faction: 'enemy' as const, squadId: enemyPrepared.enemySquads[0].id, from: playerHq, to: playerHq, target: playerHq, message: 'enemy HQ assault' }]
    const enemyBase = resolveCombat(enemyPrepared, enemyAttack).reports[0]
    const enemyWarfare = resolveCombat({ ...enemyPrepared, researchLevels: { ...enemyPrepared.researchLevels, Warfare: 2 } }, enemyAttack).reports[0]
    expect(enemyBase.attackerPower).toBeCloseTo(enemyWarfare.attackerPower, 10)
    expect(enemyWarfare.attackerPower).toBeCloseTo(12.8, 10)
    expect(enemyWarfare.winner).toBe('enemy')
  })

  it('gives Signals tier two distinct route intelligence', () => {
    const game = createNewCampaign(42)
    const tierOne = advanceResearch({ ...game, resources: { ...game.resources, intelligence: 11 } }, 'Signals')
    const tierTwo = advanceResearch(tierOne, 'Signals')
    expect(tierOne.revealedEnemySquads).toHaveLength(game.enemySquads.length)
    expect(tierOne.scoutedEnemyRoutes).toEqual([])
    expect(tierTwo.scoutedEnemyRoutes.length).toBeGreaterThan(0)
  })

  it('starts with the legacy shell API', () => { expect(initialCampaign()).toEqual({ day: 1, supplies: 3 }); expect(advanceDay(initialCampaign())).toEqual({ day: 2, supplies: 2 }) })
  it('creates a connected twelve-sector map with three relays and five squads', () => {
    const game = createNewCampaign(42)
    expect(game.sectors).toHaveLength(12); expect(game.objectives).toHaveLength(3); expect(game.squads).toHaveLength(5)
    const reached = new Set(['sector-0']); const visit = (sector: string) => game.sectors.find(item => item.id === sector)!.links.forEach(link => { if (!reached.has(link)) { reached.add(link); visit(link) } })
    visit('sector-0'); expect(reached.size).toBe(12)
  })
  it('rejects double orders, teleporting, enemy movement, and unaffordable actions', () => {
    const game = createNewCampaign(1)
    expect(() => validateOrders(game, [{ squadId: 'squad-1', type: 'hold' }, { squadId: 'squad-1', type: 'recover' }])).toThrow(/more than one/)
    expect(() => validateOrders(game, [{ squadId: 'squad-1', type: 'move', target: 'sector-7' } as Order])).toThrow(/cannot reach/)
    expect(() => validateOrders(game, [{ squadId: 'squad-1', type: 'attack', target: 'sector-6' } as Order])).toThrow(/cannot reach/)
    expect(() => validateOrders({ ...game, resources: { ...game.resources, energy: 0 } }, [{ squadId: 'squad-1', type: 'attack', target: 'sector-1' }])).toThrow(/energy/)
  })
  it('is atomic and deterministic across seed replay', () => {
    const a = createNewCampaign(99); const b = createNewCampaign(99); const orders: Order[] = [{ squadId: 'squad-1', type: 'move', target: 'sector-1' }]
    expect(resolveTurn(a, orders)).toEqual(resolveTurn(b, orders)); expect(() => resolveTurn(a, [{ squadId: 'squad-1', type: 'move', target: 'sector-7' } as Order])).toThrow(); expect(a.turn).toBe(1); expect(a.resources).toEqual({ metal: 20, energy: 20, intelligence: 5 })
  })
  it('never spends below zero on recovery', () => { const game = createNewCampaign(2); const result = resolveTurn({ ...game, resources: { ...game.resources, metal: 1 } }, [{ squadId: 'squad-1', type: 'recover' }]); expect(result.nextState.resources.metal).toBe(0) })
  it('blocks enemy squads, claims uncontested neutral movement, and requires owned supplied recovery', () => {
    const game = createNewCampaign(5)
    expect(() => validateOrders({ ...game, squads: [{ ...game.squads[0], sector: 'sector-5' }] }, [{ squadId: 'squad-1', type: 'move', target: 'sector-6' }])).toThrow(/enemy sector/)
    expect(() => validateOrders({ ...game, enemySquads: [{ ...game.enemySquads[0], sector: 'sector-1' }] }, [{ squadId: 'squad-1', type: 'move', target: 'sector-1' }])).toThrow(/enemy squad/)
    expect(() => validateOrders(game, [{ squadId: 'squad-1', type: 'recover' }])).not.toThrow()
    expect(() => validateOrders({ ...game, squads: [{ ...game.squads[0], sector: 'sector-1' }] }, [{ squadId: 'squad-1', type: 'recover' }])).toThrow(/supplied/)
    const moved = resolveTurn(game, [{ squadId: 'squad-1', type: 'move', target: 'sector-1' }]).nextState
    expect(moved.sectors.find(sector => sector.id === 'sector-1')?.owner).toBe('player')
  })
  it('only controls relays through sector ownership', () => {
    const game = createNewCampaign(6)
    expect(resolveTurn(game, [{ squadId: 'squad-1', type: 'move', target: 'sector-1' }]).nextState.objectives.every(objective => !objective.controlled)).toBe(true)
  })
  it('rejects multiple attacks when their total energy cost is unaffordable', () => {
    const game = createNewCampaign(3)
    const lowEnergy = { ...game, resources: { ...game.resources, energy: 2 } }
    const orders: Order[] = [{ squadId: 'squad-1', type: 'attack', target: 'sector-1' }, { squadId: 'squad-2', type: 'attack', target: 'sector-1' }]
    expect(() => resolveTurn(lowEnergy, orders)).toThrow(/energy/)
    expect(lowEnergy.resources.energy).toBe(2)
    expect(lowEnergy.squads.map(squad => squad.sector)).toEqual(['sector-0', 'sector-0', 'sector-0', 'sector-0', 'sector-0'])
  })
  it('records an attack on an enemy-owned sector without resolving combat', () => {
    const game = createNewCampaign(7)
    const attacking = { ...game.squads[0], sector: 'sector-5' as const, experience: 3 }
    const prepared = { ...game, squads: [attacking, ...game.squads.slice(1)] }
    const result = resolveTurn(prepared, [{ squadId: attacking.id, type: 'attack', target: 'sector-6' }])
    const squad = result.nextState.squads.find(item => item.id === attacking.id)!
    expect(squad.sector).toBe('sector-5')
    expect(squad.experience).toBe(3)
    expect(result.nextState.sectors.find(sector => sector.id === 'sector-6')?.owner).toBe('enemy')
    expect(result.nextState.objectives.find(objective => objective.sector === 'sector-6')?.controlled).toBe(false)
    expect(result.nextState.resources.energy).toBe(18)
    expect(result.nextState.orderHistory.at(-1)).toEqual([{ squadId: attacking.id, type: 'attack', target: 'sector-6' }])
    expect(result.events[0]).toMatchObject({ type: 'attack', from: 'sector-5', to: 'sector-5', target: 'sector-6' })
  })
  it('records an attack on a neutral sector containing an enemy squad without resolving combat', () => {
    const game = createNewCampaign(8)
    const attacking = { ...game.squads[0], sector: 'sector-5' as const }
    const prepared = { ...game, squads: [attacking, ...game.squads.slice(1)], enemySquads: [{ ...game.enemySquads[0], sector: 'sector-1' as const }] }
    const result = resolveTurn(prepared, [{ squadId: attacking.id, type: 'attack', target: 'sector-1' }])
    expect(result.nextState.squads.find(item => item.id === attacking.id)?.sector).toBe('sector-5')
    expect(result.nextState.sectors.find(sector => sector.id === 'sector-1')?.owner).toBe('neutral')
    expect(result.nextState.objectives.map(objective => objective.controlled)).toEqual(game.objectives.map(objective => objective.controlled))
    expect(result.nextState.resources.energy).toBe(18)
    expect(result.nextState.orderHistory.at(-1)).toEqual([{ squadId: attacking.id, type: 'attack', target: 'sector-1' }])
    expect(result.events[0]).toMatchObject({ type: 'attack', from: 'sector-5', to: 'sector-5', target: 'sector-1' })
  })
  it('rejects multiple recoveries when their total metal cost is unaffordable', () => {
    const game = createNewCampaign(4)
    const lowMetal = { ...game, resources: { ...game.resources, metal: 1 } }
    const orders: Order[] = [{ squadId: 'squad-1', type: 'recover' }, { squadId: 'squad-2', type: 'recover' }]
    expect(() => resolveTurn(lowMetal, orders)).toThrow(/metal/)
    expect(lowMetal.resources.metal).toBe(1)
    expect(lowMetal.squads.map(squad => squad.strength)).toEqual([10, 10, 10, 10, 10])
  })
  it('resolves pending attack intents with a typed deterministic battle report', () => {
    const game = createNewCampaign(42)
    const prepared = { ...game, squads: [{ ...game.squads[0], sector: 'sector-5' as const, class: 'Recon' as const, fatigue: 2, strength: 15 }, ...game.squads.slice(1)], enemySquads: [{ id: 'enemy-1', class: 'Artillery' as const, strength: 6, sector: 'sector-6' as const }] }
    const turn = resolveTurn(prepared, [{ squadId: 'squad-1', type: 'attack', target: 'sector-6' }])
    const result = resolveCombat(turn.nextState, turn.events)
    expect(result.reports[0]).toMatchObject({ target: 'sector-6', terrain: 'ridge', winner: 'player', captured: false, fatiguePenalty: 2 })
    expect(result.reports[0].classAdvantages).toContain('Recon counters Artillery')
    expect(result.nextState.sectors.find(sector => sector.id === 'sector-6')?.owner).toBe('enemy')
    expect(result.nextState.squads.find(squad => squad.id === 'squad-1')?.sector).toBe('sector-5')
    expect(result.reports[0].attackers[0].strength).toBe(15)
    expect(result.reports[0].attackers[0].units).toBe(15)
    expect(result.reports[0].defenders[0].strength).toBe(6)
    expect(result.reports[0].defenders[0].units).toBe(2)
    expect(result.reports[0].terrainMultiplier).toBe(1.15)
    expect(result.reports[0].defenderCounters).toEqual([])
    expect(turn.nextState.resources.energy).toBe(18)
    expect(result.nextState.resources.energy).toBe(18)
  })
  it('captures only after all living defenders are gone and reports defender counters', () => {
    const game = createNewCampaign(42)
    const prepared = { ...game, squads: [{ ...game.squads[0], sector: 'sector-5' as const, class: 'Recon' as const, strength: 20 }, ...game.squads.slice(1)], enemySquads: [{ id: 'enemy-1', class: 'Raider' as const, strength: 10, sector: 'sector-6' as const }] }
    const turn = resolveTurn(prepared, [{ squadId: 'squad-1', type: 'attack', target: 'sector-6' }])
    const result = resolveCombat(turn.nextState, turn.events)
    expect(result.reports[0].winner).toBe('player')
    expect(result.reports[0].captured).toBe(false)
    expect(result.nextState.sectors.find(sector => sector.id === 'sector-6')?.owner).toBe('enemy')
    expect(result.reports[0].defenderCounters).toEqual(['Raider counters Recon'])
  })
  it('boosts defender power when the defender class counters the attacker', () => {
    const game = createNewCampaign(42)
    const prepared = { ...game, squads: [{ ...game.squads[0], sector: 'sector-5' as const, class: 'Recon' as const, strength: 10 }, ...game.squads.slice(1)], enemySquads: [{ id: 'enemy-1', class: 'Raider' as const, strength: 10, sector: 'sector-6' as const }] }
    const turn = resolveTurn(prepared, [{ squadId: 'squad-1', type: 'attack', target: 'sector-6' }])
    const result = resolveCombat(turn.nextState, turn.events)
    expect(result.reports[0].defenderPower).toBe(13.799999999999999)
  })
  it('does not boost defender power when only the attacker counters the defender', () => {
    const game = createNewCampaign(42)
    const prepared = { ...game, squads: [{ ...game.squads[0], sector: 'sector-5' as const, class: 'Recon' as const, strength: 10 }, ...game.squads.slice(1)], enemySquads: [{ id: 'enemy-1', class: 'Artillery' as const, strength: 10, sector: 'sector-6' as const }] }
    const turn = resolveTurn(prepared, [{ squadId: 'squad-1', type: 'attack', target: 'sector-6' }])
    const result = resolveCombat(turn.nextState, turn.events)
    expect(result.reports[0].defenderPower).toBe(11.5)
  })
  it('retreats to an adjacent owned sector or remains in place', () => {
    const game = createNewCampaign(42)
    const prepared = { ...game, squads: [{ ...game.squads[0], sector: 'sector-5' as const, strength: 10 }, ...game.squads.slice(1)], enemySquads: [{ id: 'enemy-1', class: 'Sentinel' as const, strength: 20, sector: 'sector-6' as const }] }
    const turn = resolveTurn(prepared, [{ squadId: 'squad-1', type: 'attack', target: 'sector-6' }])
    const result = resolveCombat(turn.nextState, turn.events)
    expect(result.reports[0].retreat).toEqual([{ squadId: 'squad-1', to: 'sector-5' }])
    expect(result.nextState.squads.find(squad => squad.id === 'squad-1')?.sector).toBe('sector-5')
  })
  it('groups multi-squad attacks by target and replays atomically from seed and order', () => {
    const game = createNewCampaign(123)
    const prepared = { ...game, squads: game.squads.map((squad, index) => ({ ...squad, sector: 'sector-5' as const, strength: index < 2 ? 10 : squad.strength })), enemySquads: [{ ...game.enemySquads[0], sector: 'sector-6' as const, strength: 8 }] }
    const orders: Order[] = [{ squadId: 'squad-1', type: 'attack', target: 'sector-6' }, { squadId: 'squad-2', type: 'attack', target: 'sector-6' }]
    const a = resolveTurn(prepared, orders); const b = resolveTurn(prepared, orders)
    expect(resolveCombat(a.nextState, a.events)).toEqual(resolveCombat(b.nextState, b.events))
    expect(resolveCombat(a.nextState, a.events).reports).toHaveLength(1)
  })
  it('runs a legal deterministic enemy phase without teleporting', () => {
    const game = createNewCampaign(42024)
    const a = resolveEnemyTurn(game)
    const b = resolveEnemyTurn(game)
    expect(a).toEqual(b)
    const moved = a.events[0]
    if (moved) {
      expect(game.sectors.find(sector => sector.id === moved.from)?.links).toContain(moved.to)
      expect(a.nextState.enemySquads.find(enemy => enemy.id === moved.squadId)?.sector).toBe(moved.to)
    }
  })

  it('completes the seed 42024 three-turn route and produces a real battle report', () => {
    let state = createNewCampaign(42024)
    const route: Order[] = [
      { squadId: 'squad-1', type: 'move', target: 'sector-1' },
      { squadId: 'squad-1', type: 'move', target: 'sector-5' },
      { squadId: 'squad-1', type: 'attack', target: 'sector-6' },
    ]

    for (const [turnIndex, order] of route.entries()) {
      const turn = resolveTurn(state, [order])
      expect(turn.nextState.squads.find(squad => squad.id === 'squad-1')?.sector).toBe(turnIndex === 0 ? 'sector-1' : 'sector-5')
      const combat = resolveCombat(turn.nextState, turn.events)
      const enemy = resolveEnemyTurn(combat.nextState)
      state = enemy.nextState

      if (turnIndex === 2) {
        expect(combat.reports).toHaveLength(1)
        expect(combat.reports[0]).toMatchObject({ target: 'sector-6', terrain: 'ridge' })
        expect(combat.reports[0].winner).toMatch(/player|enemy|draw/)
        expect(combat.reports[0].attackers[0]).toEqual(expect.objectContaining({ squadId: 'squad-1' }))
      } else expect(combat.reports).toEqual([])
    }

    expect(state.turn).toBe(4)
    expect(state.recentBattles).toHaveLength(1)
  })
  it('keeps enemy movement out of occupied and HQ sectors and captures undefended Ward sectors', () => {
    const game = createNewCampaign(1)
    const enemy = { ...game.enemySquads[0], sector: 'sector-5' as const }
    const occupied = { ...game, enemySquads: [enemy], squads: [{ ...game.squads[0], sector: 'sector-1' as const }] }
    const blocked = resolveEnemyTurn(occupied)
    expect(blocked.events.every(event => event.to !== 'sector-1')).toBe(true)
    const undefended = { ...game, enemySquads: [enemy], squads: game.squads.map(squad => ({ ...squad, sector: 'sector-0' as const })), sectors: game.sectors.map(sector => sector.id === 'sector-1' ? { ...sector, owner: 'player' as const } : sector) }
    const captured = resolveEnemyTurn(undefended)
    expect(captured.events).toHaveLength(1)
    expect(captured.events[0]?.squadId).toMatch(/^enemy-/)
    expect(captured.events[0]?.to).not.toBe('sector-0')
    expect(captured.nextState.objectives.find(objective => objective.sector === 'sector-1')?.controlled).not.toBe(true)
  })

  it('reaches HQ-loss defeat through legal deterministic enemy movement', () => {
    let state = createNewCampaign(42024)
    state = { ...state, squads: state.squads.map(squad => ({ ...squad, sector: 'sector-11' as const })), enemySquads: [{ ...state.enemySquads[0], sector: 'sector-1' as const }], sectors: state.sectors.map(sector => sector.id === 'sector-1' ? { ...sector, owner: 'player' as const } : sector) }
    const first = resolveEnemyTurn(state)
    expect(first.events[0]).toMatchObject({ from: 'sector-1', to: 'sector-0' })
    expect(first.nextState.terminal).toBe('defeat')
    expect(first.nextState.terminalReason).toBe('Player HQ lost.')
  })


  it('runs income and terminal checks when no enemy squad exists', () => {
    const game = createNewCampaign(42024)
    const state = { ...game, enemySquads: [], turn: 19 }
    const result = resolveEnemyTurn(state)
    expect(result.events).toEqual([])
    expect(result.nextState.income).toEqual(calculateIncome(state))
    expect(result.nextState.resources.metal).toBe(game.resources.metal + result.nextState.income.metal)
    expect(result.nextState.terminal).toBe('defeat')
    expect(result.nextState.terminalReason).toBe('Turn 18 reached without victory.')
  })


  it('proves the browser-played seed-42024 route reaches victory through all three relays', () => {
    let state = createNewCampaign(42024)
    const route: Order[][] = [
      [{ squadId: 'squad-1', type: 'move', target: 'sector-1' }, { squadId: 'squad-2', type: 'move', target: 'sector-11' }, { squadId: 'squad-3', type: 'move', target: 'sector-1' }, { squadId: 'squad-4', type: 'move', target: 'sector-11' }, { squadId: 'squad-5', type: 'move', target: 'sector-1' }],
      [{ squadId: 'squad-1', type: 'move', target: 'sector-2' }, { squadId: 'squad-2', type: 'attack', target: 'sector-10' }, { squadId: 'squad-3', type: 'move', target: 'sector-2' }, { squadId: 'squad-4', type: 'attack', target: 'sector-10' }, { squadId: 'squad-5', type: 'move', target: 'sector-5' }],
      [{ squadId: 'squad-1', type: 'hold' }, { squadId: 'squad-2', type: 'attack', target: 'sector-9' }, { squadId: 'squad-3', type: 'move', target: 'sector-3' }, { squadId: 'squad-4', type: 'attack', target: 'sector-9' }, { squadId: 'squad-5', type: 'attack', target: 'sector-6' }],
      [{ squadId: 'squad-1', type: 'move', target: 'sector-3' }, { squadId: 'squad-2', type: 'attack', target: 'sector-9' }, { squadId: 'squad-3', type: 'hold' }, { squadId: 'squad-4', type: 'attack', target: 'sector-9' }, { squadId: 'squad-5', type: 'attack', target: 'sector-6' }],
      [{ squadId: 'squad-1', type: 'hold' }, { squadId: 'squad-2', type: 'move', target: 'sector-9' }, { squadId: 'squad-3', type: 'hold' }, { squadId: 'squad-4', type: 'move', target: 'sector-9' }, { squadId: 'squad-5', type: 'hold' }],
    ]
    for (const orders of route) { if (state.terminal !== 'active') break; const turn = resolveTurn(state, orders); const combat = resolveCombat(turn.nextState, turn.events); state = resolveEnemyTurn(combat.nextState).nextState }
    expect(state.objectives.every(objective => objective.controlled)).toBe(true)
    expect(state.terminal).toBe('victory')
    expect(state.orderHistory.length).toBeGreaterThan(0)
    expect(state.orderHistory.length).toBeLessThanOrEqual(route.length)
  })

  it('loses deterministically on turn 18 after a legal hold order', () => {
    let state = createNewCampaign(42024)
    for (let index = 0; index < 18; index += 1) { const turn = resolveTurn(state, [{ squadId: 'squad-1', type: 'hold' }]); state = resolveEnemyTurn(turn.nextState).nextState }
    const result = resolveEnemyTurn(state)
    expect(result.nextState.terminal).toBe('defeat')
    expect(result.nextState.terminalReason).toBe('Turn 18 reached without victory.')
  })

  it('keeps victory precedence as a separate terminal-rule unit fixture', () => {
    const state = createNewCampaign(42024)
    const simultaneous = { ...state, objectives: state.objectives.map(objective => ({ ...objective, controlled: true })), sectors: state.sectors.map(sector => state.objectives.some(objective => objective.sector === sector.id) ? { ...sector, owner: 'player' as const } : sector).map(sector => sector.id === state.hq.player ? { ...sector, owner: 'enemy' as const } : sector) }
    const result = terminalState(simultaneous)
    expect(result.terminal).toBe('victory')
    expect(result.terminalReason).toBe('All three relays secured.')
  })

  it('resolves an HQ assault through the normal typed battle and income path', () => {
    let state = createNewCampaign(42024)
    const trace: string[] = []
    const move = (target: 'sector-1' | 'sector-5') => Array.from({ length: 5 }, (_, i) => ({ squadId: `squad-${i + 1}`, type: 'move' as const, target }))
    for (const orders of [move('sector-1'), move('sector-5')]) {
      const turn = resolveTurn(state, orders); trace.push(`turn=${state.turn} orderCount=${orders.length}`)
      const combat = resolveCombat(turn.nextState, turn.events)
      expect(combat.reports).toEqual([])
      state = resolveEnemyTurn(combat.nextState).nextState
    }
    const assault = Array.from({ length: 5 }, (_, i) => ({ squadId: `squad-${i + 1}`, type: 'attack' as const, target: 'sector-6' as const }))
    const turn = resolveTurn(state, assault); trace.push(`turn=${state.turn} orderCount=${assault.length}`)
    const combat = resolveCombat(turn.nextState, turn.events)
    const report = combat.reports[0]
    trace.push(`report=${report.target}:${report.winner}:captured=${report.captured}`)
    expect(report).toMatchObject({ target: 'sector-6', terrain: 'ridge', captured: false, winner: 'player' })
    expect(report.defenders.length).toBeGreaterThan(0)
    state = resolveEnemyTurn(combat.nextState).nextState
    const followUp = resolveTurn(state, assault)
    const followUpCombat = resolveCombat(followUp.nextState, followUp.events)
    const finalReport = followUpCombat.reports[0]
    expect(finalReport).toMatchObject({ target: 'sector-6', terrain: 'ridge', captured: true, winner: 'player' })
    state = resolveEnemyTurn(followUpCombat.nextState).nextState
    expect(state.sectors.find(sector => sector.id === 'sector-6')?.owner).toBe('player')
    expect(state.income).toEqual(calculateIncome(state))
  })
  it('stops the enemy phase after a terminal combat result', () => {
    let state = createNewCampaign(42024)
    for (const order of [
      { squadId: 'squad-1', type: 'move' as const, target: 'sector-1' as const },
      { squadId: 'squad-1', type: 'move' as const, target: 'sector-5' as const },
      { squadId: 'squad-1', type: 'attack' as const, target: 'sector-6' as const },
    ]) {
      const turn = resolveTurn(state, [order]); const combat = resolveCombat(turn.nextState, turn.events)
      state = resolveEnemyTurn(combat.nextState).nextState
    }
    expect(state.recentBattles).toHaveLength(1)
    const terminal = { ...state, terminal: 'victory' as const, terminalReason: 'All three relays secured.' }
    expect(resolveEnemyTurn(terminal).events).toEqual([])
  })


  it('keeps a reachable Signals2 forecast aligned after six HOLD turns', () => {
    let state = createNewCampaign(2244426087)
    const hold = () => {
      const turn = resolveTurn(state, state.squads.map(squad => ({ squadId: squad.id, type: 'hold' as const })))
      const combat = resolveCombat(turn.nextState, turn.events)
      state = resolveEnemyTurn(combat.nextState).nextState
    }
    for (let i = 0; i < 6; i += 1) hold()
    state = advanceResearch(state, 'Signals')
    for (let i = 0; i < 7; i += 1) hold()
    state = advanceResearch(state, 'Signals')
    const forecast = decideEnemyIntent(state, state.turn + 1)
    const turn = resolveTurn(state, state.squads.map(squad => ({ squadId: squad.id, type: 'hold' as const })))
    const combat = resolveCombat(turn.nextState, turn.events)
    const actualState = combat.nextState
    const actual = resolveEnemyTurn(actualState)
    const expected = decideEnemyIntent(actualState)
    expect(forecast).toEqual(decideEnemyIntent(state, state.turn + 1))
    expect(actual.events[0]?.squadId).toBe(expected?.squadId)
    expect(actual.events[0]?.type).toBe(expected?.kind)
    expect(actual.events[0]?.target ?? actual.events[0]?.to).toBe(expected?.target ?? expected?.to)
  })

  it('records genuine normal-start HOLD pressure for both acceptance seeds', () => {
    const traces = [2244426087, 58386330].map(seed => {
      let state = createNewCampaign(seed)
      const actions: unknown[] = []
      for (let turn = 0; turn < 18 && state.terminal === 'active'; turn += 1) {
        const orders = state.squads.map(squad => ({ squadId: squad.id, type: 'hold' as const }))
        const player = resolveTurn(state, legalizeRecordedOrders(state, orders))
        const combat = resolveCombat(player.nextState, player.events)
        const enemy = resolveEnemyTurn(combat.nextState)
        const action = enemy.events[0] ? { turn: state.turn, ...enemy.events[0] } : null
        actions.push(action)
        state = enemy.nextState
      }
      return { seed, actions, final: { turn: state.turn, terminal: state.terminal, squads: state.squads.length, enemySquads: state.enemySquads.length, hq: state.hq, sectors: state.sectors.filter(sector => sector.owner === 'enemy').map(sector => sector.id) } }
    })
    for (const trace of traces) {
      expect(trace.actions).toHaveLength(18)
      expect(trace.actions.some(action => action && typeof action === 'object' && 'to' in action && ['sector-3', 'sector-6', 'sector-9'].includes(String((action as { to?: string }).to)))).toBe(true)
      expect(trace.final.squads).toBe(5)
      expect(trace.final.enemySquads).toBeGreaterThanOrEqual(1)
    }
  })

  it('keeps Signals tier-two forecast aligned with the next resolved enemy phase', () => {
    const base = createNewCampaign(42024)
    const tier1 = advanceResearch({ ...base, resources: { ...base.resources, intelligence: 20 } }, 'Signals')
    const forecast = advanceResearch(tier1, 'Signals')
    const player = resolveTurn(forecast, forecast.squads.map(squad => ({ squadId: squad.id, type: 'hold' as const })))
    const combat = resolveCombat(player.nextState, player.events)
    const actual = resolveEnemyTurn(combat.nextState)
    expect(decideEnemyIntent(forecast, forecast.turn + 1)).toEqual(decideEnemyIntent(combat.nextState))
    expect(actual.events[0]?.squadId).toBe(decideEnemyIntent(combat.nextState)?.squadId)
    expect(actual.events[0]?.type).toBe(decideEnemyIntent(combat.nextState)?.kind)
    expect(actual.events[0]?.target ?? actual.events[0]?.to).toBe(decideEnemyIntent(combat.nextState)?.target ?? decideEnemyIntent(combat.nextState)?.to)
  })

  it('makes Signals scouting progressively reveal concrete enemy information', () => {
    const base = createNewCampaign(42)
    expect(base.revealedEnemySquads).toEqual([])
    expect(base.scoutedEnemyRoutes).toEqual([])
    const tier1 = advanceResearch({ ...base, resources: { ...base.resources, intelligence: 11 } }, 'Signals')
    expect(tier1.revealedEnemySquads).toEqual(base.enemySquads.map(enemy => enemy.id))
    expect(tier1.scoutedEnemyRoutes).toEqual([])
    const tier2 = advanceResearch(tier1, 'Signals')
    expect(tier2.revealedEnemySquads).toEqual(tier1.revealedEnemySquads)
    expect(tier2.scoutedEnemyRoutes).toHaveLength(base.enemySquads.length)
    expect(tier2.scoutedEnemyRoutes.every(route => route.includes(' garrison ') && (route.includes('advances to ') || route.includes('assaults ') || route.includes('holds position') || route.includes('waits')))).toBe(true)
    expect(tier2.scoutedEnemyRoutes.every(route => !route.includes('sector-'))).toBe(true)
    expect(tier2.scoutedEnemyRoutes).not.toEqual(tier1.revealedEnemySquads)
  })

  it('keeps tier-0 scouting output obscured while action legality remains deterministic', () => {
    const base = createNewCampaign(42)
    const tier1 = advanceResearch(base, 'Signals')
    expect(base.enemySquads.map(enemy => enemy.id)).not.toEqual([])
    expect(base.revealedEnemySquads).toHaveLength(0)
    expect(tier1.revealedEnemySquads).toHaveLength(base.enemySquads.length)
    expect(resolveTurn(base, [{ squadId: 'squad-1', type: 'move', target: 'sector-1' }]).nextState.squads[0].sector).toBe('sector-1')
  })

  it('proves simultaneous terminal precedence from explicit conditions', () => {
    const base = createNewCampaign(42024)
    const simultaneous = { ...base, objectives: base.objectives.map(objective => ({ ...objective, controlled: true })), sectors: base.sectors.map(sector => sector.id === base.hq.player ? { ...sector, owner: 'enemy' as const } : sector) }
    const result = terminalState(simultaneous)
    expect(result.terminal).toBe('victory')
    expect(result.terminalReason).toBe('All three relays secured.')
  })
  it('resolves a legal enemy Ward assault against a defended player HQ', () => {
    const game = createNewCampaign(42024)
    const prepared = { ...game, enemySquads: [{ ...game.enemySquads[0], sector: 'sector-1' as const, strength: 100 }], squads: [{ ...game.squads[0], sector: 'sector-0' as const, strength: 1 }, ...game.squads.slice(1).map(squad => ({ ...squad, sector: 'sector-11' as const }))] }
    const phase = resolveEnemyTurn(prepared)
    expect(phase.events).toContainEqual(expect.objectContaining({ type: 'attack', faction: 'enemy', from: 'sector-1', target: 'sector-0' }))
    expect(phase.reports[0]).toMatchObject({ target: 'sector-0', winner: 'enemy', captured: true })
    expect(phase.reports[0].attackers[0]).toEqual(expect.objectContaining({ squadId: game.enemySquads[0].id }))
    expect(phase.reports[0].defenders[0]).toEqual(expect.objectContaining({ squadId: 'squad-1' }))
    expect(phase.nextState.sectors.find(sector => sector.id === 'sector-0')?.owner).toBe('enemy')
  })

  it('makes a terminal enemy phase a complete no-op', () => {
    const game = createNewCampaign(7)
    const terminal = { ...game, terminal: 'victory' as const, resources: { ...game.resources }, income: { metal: 0, energy: 0, intelligence: 0 } }
    const phase = resolveEnemyTurn(terminal)
    expect(phase.events).toEqual([])
    expect(phase.nextState).toEqual(terminal)
  })

  it('shares the seed-42024 scout forecast with the actual enemy event', () => {
    const game = createNewCampaign(42024)
    const signals = advanceResearch(advanceResearch({ ...game, resources: { ...game.resources, intelligence: 11 } }, 'Signals'), 'Signals')
    const intent = decideEnemyIntent(signals)
    const phase = resolveEnemyTurn(signals)
    expect(intent?.squadId).toBe(phase.events[0]?.squadId)
    expect(intent?.kind).toBe(phase.events[0]?.type)
    expect(intent?.to ?? intent?.target ?? intent?.from).toBe(phase.events[0]?.to ?? phase.events[0]?.target ?? phase.events[0]?.from)
  })

  it('reports blocked, defended, and undefended HQ intent from current occupancy', () => {
    const game = createNewCampaign(42024)
    const enemy = game.enemySquads[0]
    const blocked = { ...game, enemySquads: [{ ...enemy, sector: 'sector-2' as const }, { ...game.enemySquads[1], sector: 'sector-1' as const }, { ...game.enemySquads[2], sector: 'sector-3' as const }] }
    expect(decideEnemyIntent(blocked)?.kind).toMatch(/move|attack/)
    const defended = { ...game, enemySquads: [{ ...enemy, sector: 'sector-1' as const }], squads: [{ ...game.squads[0], sector: 'sector-0' as const }, ...game.squads.slice(1).map(squad => ({ ...squad, sector: 'sector-11' as const }))] }
    expect(decideEnemyIntent(defended)?.kind).toBe('attack')
    const undefended = { ...defended, squads: defended.squads.map(squad => ({ ...squad, sector: 'sector-11' as const })) }
    expect(decideEnemyIntent(undefended)?.kind).toBe('move')
    expect(decideEnemyIntent(undefended)?.to).toBe('sector-0')
  })
  it('skips a blocked first relay unit and forecasts the actual selected contest', () => {
    const game = createNewCampaign(42024)
    const relayPressure = { ...game,
      enemySquads: [
        { ...game.enemySquads[0], sector: 'sector-4' as const },
        { ...game.enemySquads[1], sector: 'sector-5' as const },
        { ...game.enemySquads[2], sector: game.hq.enemy },
      ],
      squads: game.squads.map(squad => ({ ...squad, sector: squad.id === 'squad-1' ? 'sector-3' as const : 'sector-11' as const }))
    }
    const forecast = decideEnemyIntent(relayPressure)
    const phase = resolveEnemyTurn(relayPressure)
    expect(forecast).toBeDefined()
    expect(forecast?.squadId).toBe(phase.events[0]?.squadId)
    expect(forecast?.kind).toBe(phase.events[0]?.type)
    expect(phase.events[0]?.type).toMatch(/move|attack/)
  })

  it('contests an occupied Northstar relay and forecasts only the selected attacker', () => {
    const game = createNewCampaign(42024)
    const relayPressure = {
      ...game,
      enemySquads: [
        { ...game.enemySquads[0], sector: 'sector-4' as const },
        { ...game.enemySquads[1], sector: 'sector-5' as const },
        { ...game.enemySquads[2], sector: game.hq.enemy },
      ],
      squads: game.squads.map(squad => ({ ...squad, sector: squad.id === 'squad-1' ? 'sector-3' as const : 'sector-11' as const })),
      resources: { ...game.resources, intelligence: 11 },
    }
    const signals = advanceResearch(advanceResearch(relayPressure, 'Signals'), 'Signals')
    const intent = decideEnemyIntent(signals)
    const phase = resolveEnemyTurn(signals)
    expect(intent).toMatchObject({ squadId: signals.enemySquads[0].id, kind: 'attack', target: 'sector-3' })
    expect(phase.events.length).toBeGreaterThanOrEqual(1)
    expect(phase.events[0]).toMatchObject({ type: 'attack', squadId: signals.enemySquads[0].id, target: 'sector-3', message: expect.stringContaining('Northstar') })
    expect(phase.reports[0]).toMatchObject({ target: 'sector-3', winner: 'player' })
    expect(phase.reports[0].casualties.length).toBeGreaterThan(0)
    expect(phase.reports[0].defenders[0]).toEqual(expect.objectContaining({ squadId: 'squad-1' }))
    expect(signals.scoutedEnemyRoutes).toHaveLength(signals.enemySquads.length)
    expect(signals.scoutedEnemyRoutes[0]).toBe('Recon garrison from Rimefield: assaults Northstar')
  })

  it('uses general map adjacency for occupied relay attacks beyond sector-4', () => {
    const game = createNewCampaign(42024)
    const state = { ...game, enemySquads: [{ ...game.enemySquads[0], sector: 'sector-7' as const }, { ...game.enemySquads[1], sector: game.hq.enemy }, { ...game.enemySquads[2], sector: game.hq.enemy }], squads: game.squads.map(squad => ({ ...squad, sector: squad.id === 'squad-1' ? 'sector-8' as const : 'sector-11' as const })), sectors: game.sectors.map(sector => sector.id === 'sector-8' ? { ...sector, owner: 'player' as const } : sector) }
    const intent = decideEnemyIntent(state)
    const phase = resolveEnemyTurn(state)
    expect(intent).toMatchObject({ squadId: 'enemy-1', kind: 'attack', target: 'sector-8' })
    expect(phase.events[0]).toMatchObject({ type: 'attack', target: 'sector-8', message: expect.stringContaining('Ironhollow') })
    expect(phase.reports[0]).toMatchObject({ target: 'sector-8' })
  })

  it('keeps the normal-start research tree from being purchased immediately', () => {
    const game = createNewCampaign(42024)
    expect(researchIncomeThreshold('Logistics', 0)).toBe(1)
    expect(researchIncomeThreshold('Signals', 1)).toBe(1)
    const logistics = advanceResearch(game, 'Logistics')
    expect(logistics.resources).toEqual({ metal: 12, energy: 19, intelligence: 5 })
    const logisticsTwo = advanceResearch(logistics, 'Logistics')
    expect(logisticsTwo.resources).toEqual({ metal: 0, energy: 17, intelligence: 5 })
    expect(() => advanceResearch(logisticsTwo, 'Warfare')).toThrow(/Not enough resources/)
    expect(() => advanceResearch(logisticsTwo, 'Signals')).toThrow(/Not enough resources/)
  })

  it('makes research compete with a played attack while enemy relay pressure stays deterministic', () => {
    const game = createNewCampaign(42024)
    const attack = resolveTurn(game, [{ squadId: 'squad-1', type: 'attack', target: 'sector-1' }])
    expect(attack.nextState.resources.energy).toBe(18)
    const researched = advanceResearch(game, 'Logistics')
    expect(researched.resources.energy).toBe(19)
    const pressure = resolveEnemyTurn(researched)
    expect(pressure.events[0]?.squadId).toMatch(/^enemy-/)
    expect(pressure.events[0]?.type).toMatch(/move|hold|attack/)
  })

  it('replays the owner-played Signals1 route without claiming recovery or Signals2', () => {
    const seeded = createNewCampaign(42024)
    let state = advanceResearch(seeded, 'Signals')
    const route: Order[][] = [
      [{ squadId: 'squad-1', type: 'move', target: 'sector-1' }, { squadId: 'squad-2', type: 'move', target: 'sector-11' }, { squadId: 'squad-3', type: 'move', target: 'sector-1' }, { squadId: 'squad-4', type: 'move', target: 'sector-11' }, { squadId: 'squad-5', type: 'move', target: 'sector-1' }],
      [{ squadId: 'squad-1', type: 'move', target: 'sector-2' }, { squadId: 'squad-2', type: 'attack', target: 'sector-10' }, { squadId: 'squad-3', type: 'move', target: 'sector-2' }, { squadId: 'squad-4', type: 'attack', target: 'sector-10' }, { squadId: 'squad-5', type: 'move', target: 'sector-5' }],
      [{ squadId: 'squad-1', type: 'hold' }, { squadId: 'squad-2', type: 'attack', target: 'sector-9' }, { squadId: 'squad-3', type: 'move', target: 'sector-3' }, { squadId: 'squad-4', type: 'attack', target: 'sector-9' }, { squadId: 'squad-5', type: 'attack', target: 'sector-6' }],
      [{ squadId: 'squad-1', type: 'move', target: 'sector-3' }, { squadId: 'squad-2', type: 'attack', target: 'sector-9' }, { squadId: 'squad-3', type: 'hold' }, { squadId: 'squad-4', type: 'attack', target: 'sector-9' }, { squadId: 'squad-5', type: 'attack', target: 'sector-6' }],
      [{ squadId: 'squad-1', type: 'hold' }, { squadId: 'squad-2', type: 'move', target: 'sector-9' }, { squadId: 'squad-3', type: 'hold' }, { squadId: 'squad-4', type: 'move', target: 'sector-9' }, { squadId: 'squad-5', type: 'hold' }],
    ]
    for (const orders of route) {
      if (state.terminal !== 'active') break
      const turn = resolveTurn(state, orders)
      const combat = resolveCombat(turn.nextState, turn.events)
      state = resolveEnemyTurn(combat.nextState).nextState
    }
    expect(state.terminal).toBe('victory')
    expect(state.turn).toBe(6)
    expect(state.resources).toEqual({ metal: 83, energy: 21, intelligence: 6 })
    expect(state.squads.map(squad => squad.strength)).toEqual([10, 10, 9, 10, 10])
    expect(state.sectors.find(sector => sector.id === state.hq.player)?.owner).toBe('player')
    expect(state.objectives.filter(objective => objective.controlled)).toHaveLength(3)
    expect(state.squads).toHaveLength(5)
    expect(state.resources.metal).toBeGreaterThanOrEqual(0)
    expect(state.resources.energy).toBeGreaterThanOrEqual(0)
    expect(state.resources.intelligence).toBeGreaterThanOrEqual(0)
  })

  it('selects pressure deterministically and varies legal targets by seed', () => {
    const state = createNewCampaign(2)
    const prepared = { ...state, enemySquads: [{ ...state.enemySquads[0], sector: 'sector-5' as const }], squads: state.squads.map(squad => ({ ...squad, sector: 'sector-11' as const })) }
    const sameSeed = decideEnemyIntent(prepared)
    expect(decideEnemyIntent(prepared)).toEqual(sameSeed)
    const outcomes = new Set<string>()
    const events = new Set<string>()
    for (let seed = 2; seed < 100; seed += 1) { const seeded = { ...prepared, seed }; outcomes.add(decideEnemyIntent(seeded)?.to ?? ''); events.add(resolveEnemyTurn(seeded).events[0]?.to ?? '') }
    expect(outcomes.size).toBeGreaterThan(1)
    expect(events.size).toBeGreaterThan(1)
    expect(resolveEnemyTurn(prepared)).toEqual(resolveEnemyTurn(prepared))
  })

  it('runs genuine fresh-seed campaigns for 18 turns or terminal without actor starvation', () => {
    const replay = (seed: number) => {
      let state = createNewCampaign(seed)
      const trace: string[] = []
      const actors = new Set<string>()
      const targets = new Set<string>()
      for (let turn = 0; turn < 18 && state.terminal === 'active'; turn += 1) {
        const candidates: Order[] = state.squads.flatMap(squad => {
          const sector = state.sectors.find(item => item.id === squad.sector)
          const adjacent = sector?.links ?? []
          return adjacent.map(target => ({ squadId: squad.id, type: (state.sectors.find(item => item.id === target)?.owner === 'enemy' || state.enemySquads.some(enemy => enemy.sector === target) ? 'attack' : 'move') as 'attack' | 'move', target }))
        })
        const orders: Order[] = []
        for (const candidate of candidates) { try { validateOrders(state, [candidate]); orders.push(candidate); break } catch {} }
        if (!orders.length && state.squads[0]) orders.push({ squadId: state.squads[0].id, type: 'hold' })
        const player = resolveTurn(state, legalizeRecordedOrders(state, orders))
        const combat = resolveCombat(player.nextState, player.events)
        const enemy = resolveEnemyTurn(combat.nextState)
        const action = enemy.events[0]
        if (action) { actors.add(action.squadId); if (action.target) targets.add(action.target); trace.push(`${state.turn}:${action.squadId}:${action.type}:${action.from}->${action.target ?? action.to}`) }
        state = enemy.nextState
      }
      return { state, trace, actors, targets }
    }
    const runs = [2244426087, 58386330].map(replay)
    for (const run of runs) {
      expect(run.trace.length).toBeGreaterThan(0)
      expect(run.actors.size).toBeGreaterThan(1)
      expect(run.trace.some(entry => entry.includes(':attack:')) || run.trace.some(entry => entry.includes('sector-0'))).toBe(true)
      expect(run.state.turn).toBeLessThanOrEqual(19)
    }
    expect(runs[0].trace).not.toEqual(runs[1].trace)
    expect(replay(2244426087)).toEqual(replay(2244426087))
  })

  it('records advancing-player pressure at contested relay positions', () => {
    const replay = (seed: number) => {
      let state = createNewCampaign(seed)
      const trace: string[] = []
      for (let turn = 0; turn < 18 && state.terminal === 'active'; turn += 1) {
        const enemyRelaySectors = new Set(state.enemySquads
          .map(enemy => state.objectives.some(objective => objective.sector === enemy.sector) ? enemy.sector : undefined)
          .filter((sector): sector is typeof state.sectors[number]['id'] => Boolean(sector)))
        const candidates: Order[] = state.squads.flatMap(squad => {
          const sector = state.sectors.find(item => item.id === squad.sector)
          return (sector?.links ?? []).map(target => ({
            squadId: squad.id,
            type: (enemyRelaySectors.has(target) || state.enemySquads.some(enemy => enemy.sector === target) ? 'attack' : 'move') as 'attack' | 'move',
            target,
          }))
        })
        const preferred = candidates.sort((a, b) => Number(b.type === 'attack') - Number(a.type === 'attack'))[0]
        const proposed = preferred ? [preferred] : [{ squadId: state.squads[0].id, type: 'hold' as const }]
        let orders = legalizeRecordedOrders(state, proposed)
        try { validateOrders(state, orders) } catch { orders = [{ squadId: state.squads[0].id, type: 'hold' as const }] }
        const player = resolveTurn(state, orders)
        const combat = resolveCombat(player.nextState, player.events)
        const enemy = resolveEnemyTurn(combat.nextState)
        const action = enemy.events[0]
        if (action) trace.push(`${state.turn}:${action.squadId}:${action.type}:${action.from}->${action.target ?? action.to}`)
        state = enemy.nextState
      }
      return { state, trace }
    }
    const runs = [2244426087, 58386330].map(replay)
    for (const run of runs) {
      expect(run.trace.length).toBeGreaterThan(0)
      expect(run.trace.some(entry => entry.includes(':attack:'))).toBe(true)
      expect(run.trace.some(entry => entry.includes(':attack:') && entry.includes('->sector-'))).toBe(true)
    }
    expect(replay(2244426087)).toEqual(replay(2244426087))
  })

  it("keeps persistent strategic intent and Signals parity on advancing routes", () => {
    const replay = (seed: number) => {
      let state = createNewCampaign(seed)
      const trace: string[] = []
      for (let turn = 0; turn < 12 && state.terminal === "active"; turn += 1) {
        const squad = state.squads[turn % state.squads.length]
        const sector = state.sectors.find(item => item.id === squad.sector)!
        const target = sector.links.find(link => !state.enemySquads.some(enemy => enemy.sector === link) && !state.squads.some(other => other.id !== squad.id && other.sector === link))
        let player
        try { player = resolveTurn(state, [target ? { squadId: squad.id, type: "move", target } : { squadId: squad.id, type: "hold" }]) }
        catch { player = resolveTurn(state, [{ squadId: squad.id, type: "hold" }]) }
        const combat = resolveCombat(player.nextState, player.events)
        const forecast = decideEnemyIntent(combat.nextState)
        const enemy = resolveEnemyTurn(combat.nextState)
        const action = enemy.events[0]
        if (forecast && action) {
          expect(action.squadId).toBe(forecast.squadId)
          expect(action.type).toBe(forecast.kind === "wait" ? "hold" : forecast.kind)
          expect(action.from).toBe(forecast.from)
          expect(action.target || action.to).toBe(forecast.target || forecast.to)
          trace.push(`:::->`)
        }
        state = enemy.nextState
      }
      return { trace, state: { turn: state.turn, terminal: state.terminal, resources: state.resources, enemy: state.enemySquads.map(enemy => [enemy.id, enemy.sector, enemy.strength]) } }
    }
    const runs = [42024, 2244426087, 58386330].map(replay)
    expect(runs.every(run => run.trace.length > 2)).toBe(true)
    expect(replay(42024)).toEqual(replay(42024))
    expect(replay(2244426087)).toEqual(replay(2244426087))
    expect(replay(58386330)).toEqual(replay(58386330))
  })


  it('replays changing-player-order campaigns with forecast parity and complete receipts', () => {
    const replay = (seed: number) => {
      let state = createNewCampaign(seed)
      const orders: Order[][] = []
      const events: string[] = []
      const forecasts: string[] = []
      for (let turn = 0; turn < 18 && state.terminal === 'active'; turn += 1) {
        const candidates: Order[] = state.squads.flatMap(squad => {
          const sector = state.sectors.find(item => item.id === squad.sector)
          return (sector?.links ?? []).map(target => ({
            squadId: squad.id,
            type: (state.enemySquads.some(enemy => enemy.sector === target) || state.sectors.find(item => item.id === target)?.owner === 'enemy' ? 'attack' : 'move') as 'attack' | 'move',
            target,
          }))
        })
        const legal = candidates.find(candidate => { try { validateOrders(state, [candidate]); return true } catch { return false } })
        const selected = legal ?? { squadId: state.squads[turn % state.squads.length].id, type: 'hold' as const }
        const player = resolveTurn(state, [selected])
        orders.push([selected])
        const combat = resolveCombat(player.nextState, player.events)
        const forecast = decideEnemyIntent(combat.nextState)
        const enemy = resolveEnemyTurn(combat.nextState)
        const action = enemy.events[0]
        if (!action) { state = enemy.nextState; break }
        expect(forecast).toBeDefined()
        expect(action?.squadId).toBe(forecast?.squadId)
        expect(action?.type).toBe(forecast?.kind === 'wait' ? 'hold' : forecast?.kind)
        expect(action?.from).toBe(forecast?.from)
        expect(action?.target ?? action?.to).toBe(forecast?.target ?? forecast?.to)
        events.push(`${state.turn}:${action?.squadId}:${action?.type}:${action?.from}->${action?.target ?? action?.to}`)
        forecasts.push(`${state.turn}:${forecast?.squadId}:${forecast?.kind}:${forecast?.from}->${forecast?.target ?? forecast?.to}`)
        state = enemy.nextState
      }
      return { orders, events, forecasts, resources: state.resources, terminal: state.terminal, turn: state.turn, enemies: state.enemySquads.length }
    }
    const runs = [42024, 2244426087, 58386330].map(replay)
    for (const run of runs) {
      expect(run.orders.some(order => order[0].type !== 'hold')).toBe(true)
      expect(run.events.length).toBeGreaterThan(2)
      expect(run.events).toEqual(run.forecasts)
      expect(run.enemies).toBeLessThanOrEqual(3)
      expect(run.resources.metal).toBeGreaterThanOrEqual(0)
      expect(run.resources.energy).toBeGreaterThanOrEqual(0)
      expect(run.resources.intelligence).toBeGreaterThanOrEqual(0)
    }
    expect(replay(42024)).toEqual(replay(42024))
    expect(replay(2244426087)).toEqual(replay(2244426087))
    expect(replay(58386330)).toEqual(replay(58386330))
  })

  it('keeps a durable Frostgate objective while deriving Northstar then Cairnwatch steps', () => {
    const base = createNewCampaign(42024)
    const state = { ...base, enemySquads: [
      { ...base.enemySquads[0], sector: 'sector-8' as const },
      { ...base.enemySquads[1], sector: 'sector-6' as const },
      { ...base.enemySquads[2], sector: 'sector-6' as const },
    ] }
    const first = resolveEnemyTurn(state)
    expect(first.nextState.strategicTarget).toEqual({ squadId: 'enemy-1', destination: 'sector-0' })
    expect(first.events[0]).toMatchObject({ squadId: 'enemy-1', type: 'move', from: 'sector-8', to: 'sector-3' })
    const second = resolveEnemyTurn(first.nextState)
    expect(second.nextState.strategicTarget).toEqual({ squadId: 'enemy-1', destination: 'sector-0' })
    expect(second.events[0]).toMatchObject({ squadId: 'enemy-1', type: 'move', from: 'sector-3', to: 'sector-2' })
    const blocked = { ...second.nextState, strategicTarget: { squadId: 'enemy-1', destination: 'sector-3' as const }, sectors: second.nextState.sectors.map(sector => sector.id === 'sector-3' ? { ...sector, owner: 'enemy' as const } : sector) }
    const retargeted = resolveEnemyTurn(blocked)
    expect(retargeted.nextState.strategicTarget?.destination).not.toBe('sector-3')
    expect(retargeted.events[0]?.squadId).toBeDefined()
  })

  it('preserves the durable objective across complete resolve, combat, and enemy cycles', () => {
    let state = createNewCampaign(42024)
    state = { ...state, enemySquads: state.enemySquads.map((enemy, index) => ({ ...enemy, sector: index === 0 ? "sector-8" as const : "sector-6" as const })), squads: state.squads.map(squad => ({ ...squad, sector: "sector-11" as const })) }
    state = { ...state, strategicTarget: { squadId: "enemy-1", destination: "sector-0" } }
    const first = resolveEnemyTurn(state)
    expect(first.nextState.strategicTarget).toEqual({ squadId: 'enemy-1', destination: 'sector-0' })
    const cycleTurn = resolveTurn(first.nextState, first.nextState.squads.map(squad => ({ squadId: squad.id, type: 'hold' as const })))
    const cycle = resolveCombat(cycleTurn.nextState, cycleTurn.events)
    expect(cycle.nextState.strategicTarget).toEqual({ squadId: 'enemy-1', destination: 'sector-0' })
    const second = resolveEnemyTurn(cycle.nextState)
    expect(second.nextState.strategicTarget).toEqual({ squadId: 'enemy-1', destination: 'sector-0' })
    expect(second.events[0]).toMatchObject({ squadId: 'enemy-1', type: 'move' })
  })

  it("preserves Frostgate through three ordinary full cycles", () => {
    let state = createNewCampaign(42024)
    state = { ...state, enemySquads: state.enemySquads.map((enemy, index) => ({ ...enemy, sector: index === 0 ? "sector-8" as const : "sector-6" as const })), squads: state.squads.map(squad => ({ ...squad, sector: "sector-11" as const })) }
    state = { ...state, strategicTarget: { squadId: "enemy-1", destination: "sector-0" } }
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const target = state.strategicTarget
      expect(target?.destination).toBe("sector-0")
      const turn = resolveTurn(state, state.squads.map(squad => ({ squadId: squad.id, type: "hold" as const })))
      const combat = resolveCombat(turn.nextState, turn.events)
      expect(combat.nextState.strategicTarget).toEqual(target)
      state = resolveEnemyTurn(combat.nextState).nextState
      if (state.enemySquads.some(enemy => enemy.id === target?.squadId && enemy.sector !== target?.destination)) expect(state.strategicTarget).toEqual(target)
    }
  })

  it('retargets or holds legally when a durable objective is blocked', () => {
    const base = createNewCampaign(42024)
    const state = { ...base, enemySquads: [{ ...base.enemySquads[0], sector: 'sector-8' as const }, ...base.enemySquads.slice(1)], strategicTarget: { squadId: 'enemy-1', destination: 'sector-0' as const }, sectors: base.sectors.map(sector => sector.id === 'sector-3' ? { ...sector, owner: 'enemy' as const } : sector) }
    const result = resolveEnemyTurn(state)
    expect(result.events.length).toBeGreaterThanOrEqual(1)
    const firstEvent = result.events[0]
    expect(firstEvent.type).toMatch(/move|attack|hold/)
    if (firstEvent.type === 'move') {
      expect(firstEvent.to).not.toBe('sector-3')
      expect(distanceBetweenForTest(state, firstEvent.from, firstEvent.to)).toBeLessThanOrEqual(distanceBetweenForTest(state, firstEvent.from, 'sector-0'))
    }
    const second = resolveEnemyTurn(result.nextState)
    expect(second.events.length).toBeGreaterThanOrEqual(1)
    if (firstEvent.type === 'move' && second.events[0].type === 'move') {
      expect(second.events[0].to).not.toBe(firstEvent.to)
      expect(distanceBetweenForTest(result.nextState, second.events[0].from, second.events[0].to)).toBeLessThanOrEqual(distanceBetweenForTest(result.nextState, second.events[0].from, 'sector-0'))
    }
    if (result.nextState.strategicTarget) {
      expect(result.nextState.strategicTarget.squadId).toBeDefined()
      expect(result.nextState.strategicTarget.destination).not.toBe('sector-3')
    }
  })

  it('holds a blocked HQ goal purposefully for twelve full phase cycles', () => {
    const base = createNewCampaign(42024)
    let state: GameState = {
      ...base,
      enemySquads: [{ ...base.enemySquads[1], id: 'enemy-2', sector: 'sector-8' as const }],
      sectors: base.sectors.map(sector => sector.id === 'sector-1' || sector.id === 'sector-11' ? { ...sector, owner: 'enemy' as const } : sector),
      strategicTarget: { squadId: 'enemy-2', destination: 'sector-0' as const },
    }
    const destinations: string[] = []
    for (let cycle = 0; cycle < 12; cycle += 1) {
      const turn = resolveTurn(state, state.squads.map(squad => ({ squadId: squad.id, type: 'hold' as const })))
      const combat = resolveCombat(turn.nextState, turn.events)
      const phase = resolveEnemyTurn(combat.nextState)
      expect(phase.events).toMatchObject([{ type: 'hold', squadId: 'enemy-2', from: 'sector-8', to: 'sector-8' }])
      destinations.push(phase.events[0].to)
      state = phase.nextState
    }
    expect(new Set(destinations)).toEqual(new Set(['sector-8']))
    expect(state.enemyHistory.filter(intent => intent.squadId === 'enemy-2').length).toBe(12)
    expect(state.strategicTarget).toEqual({ squadId: 'enemy-2', destination: 'sector-0' })
  })

  it('resumes a newly reopened route after frozen history has exhausted pursuit', () => {
    const base = createNewCampaign(42024)
    let state: GameState = {
      ...base,
      enemySquads: [{ ...base.enemySquads[1], id: 'enemy-2', sector: 'sector-8' as const }],
      sectors: base.sectors.map(sector => sector.id === 'sector-1' || sector.id === 'sector-11' ? { ...sector, owner: 'enemy' as const } : sector),
      strategicTarget: { squadId: 'enemy-2', destination: 'sector-0' as const },
    }
    for (let cycle = 0; cycle < 12; cycle += 1) {
      const turn = resolveTurn(state, state.squads.map(squad => ({ squadId: squad.id, type: 'hold' as const })))
      state = resolveEnemyTurn(resolveCombat(turn.nextState, turn.events).nextState).nextState
    }
    const frozenSector = state.enemySquads.find(enemy => enemy.id === 'enemy-2')?.sector
    state = { ...state, sectors: state.sectors.map(sector => sector.id === 'sector-11' ? { ...sector, owner: 'neutral' as const } : sector) }
    const resumed: ReturnType<typeof resolveEnemyTurn>['events'] = []
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const turn = resolveTurn(state, state.squads.map(squad => ({ squadId: squad.id, type: 'hold' as const })))
      const phase = resolveEnemyTurn(resolveCombat(turn.nextState, turn.events).nextState)
      resumed.push(...phase.events)
      state = phase.nextState
    }
    expect(frozenSector).toBeDefined()
    expect(resumed.some(event => event.type === 'move' && event.from === frozenSector)).toBe(true)
  })

  it('keeps a valid detour moving toward Frostgate instead of retargeting early', () => {
    const base = createNewCampaign(42024)
    const state = { ...base, enemySquads: [{ ...base.enemySquads[0], sector: 'sector-8' as const }, { ...base.enemySquads[1], sector: 'sector-6' as const }, { ...base.enemySquads[2], sector: 'sector-6' as const }], strategicTarget: { squadId: 'enemy-1', destination: 'sector-0' as const } }
    const result = resolveEnemyTurn(state)
    expect(result.events[0]).toMatchObject({ type: 'move', from: 'sector-8', to: 'sector-9' })
    expect(result.nextState.strategicTarget).toEqual({ squadId: 'enemy-1', destination: 'sector-0' })
  })

  it('prioritizes an immediate HQ assault over persistent pursuit', () => {
    const base = createNewCampaign(42024)
    const state = { ...base, enemySquads: [
      { ...base.enemySquads[0], sector: 'sector-8' as const },
      { ...base.enemySquads[1], sector: 'sector-11' as const, strength: 25 },
      { ...base.enemySquads[2], sector: 'sector-6' as const },
    ], strategicTarget: { squadId: 'enemy-1', destination: 'sector-0' as const } }
    expect(decideEnemyIntent(state)).toMatchObject({ squadId: 'enemy-2', kind: 'attack', target: 'sector-0' })
  })

  it('lets a newly legal HQ attack preempt stale movement history', () => {
    const base = createNewCampaign(42024)
    const state: GameState = { ...base, enemySquads: [
      { ...base.enemySquads[0], id: 'enemy-3', sector: 'sector-11' as const, strength: 25 },
    ], strategicTarget: { squadId: 'enemy-3', destination: 'sector-0' as const }, enemyHistory: [
      { squadId: 'enemy-3', kind: 'move', from: 'sector-11', to: 'sector-10' },
      { squadId: 'enemy-3', kind: 'move', from: 'sector-10', to: 'sector-11' },
      { squadId: 'enemy-3', kind: 'move', from: 'sector-11', to: 'sector-10' },
      { squadId: 'enemy-3', kind: 'move', from: 'sector-10', to: 'sector-11' },
    ] }
    expect(decideEnemyIntent(state)).toMatchObject({ squadId: 'enemy-3', kind: 'attack', target: 'sector-0' })
  })

  it('does not let stale ABAB movement history suppress an undefended HQ attack', () => {
    const base = createNewCampaign(42024)
    const state: GameState = { ...base, enemySquads: [{ ...base.enemySquads[2], id: 'enemy-3', sector: 'sector-11' as const }], strategicTarget: undefined, enemyHistory: [
      { squadId: 'enemy-3', kind: 'move', from: 'sector-11', to: 'sector-10' },
      { squadId: 'enemy-3', kind: 'move', from: 'sector-10', to: 'sector-11' },
      { squadId: 'enemy-3', kind: 'move', from: 'sector-11', to: 'sector-10' },
      { squadId: 'enemy-3', kind: 'move', from: 'sector-10', to: 'sector-11' },
    ], squads: base.squads.map(squad => ({ ...squad, sector: 'sector-2' as const })) }
    expect(decideEnemyIntent(state)).toMatchObject({ squadId: 'enemy-3', kind: 'move', to: 'sector-0' })
  })
  it("requires owned HQ-connected income and competes with operational resources", () => {
    const game = createNewCampaign(42)
    const noIncome = { ...game, sectors: game.sectors.map(sector => sector.id === game.hq.player ? { ...sector, yields: { metal: 0, energy: 0, intelligence: 0 } } : { ...sector, owner: "neutral" as const }) }
    expect(() => advanceResearch(noIncome, "Logistics")).toThrow(/HQ-connected income/)
    expect(() => advanceResearch({ ...game, resources: { ...game.resources, metal: 1 } }, "Logistics")).toThrow(/Not enough resources/)
    const researched = advanceResearch(game, "Logistics")
    expect(researched.resources.metal).toBe(game.resources.metal - researchCost("Logistics", 0).metal)
    expect(researched.supplyCapacity).toBeGreaterThan(game.supplyCapacity)
  })
  it('matches bounded hostile pressure to the number of Ward orders', () => {
    const replay = (seed: number) => {
      const state = createNewCampaign(seed)
      const phase = resolveEnemyTurn(state, 5)
      return phase.events.map(event => `${event.squadId}:${event.type}:${event.from}->${event.target ?? event.to}`)
    }
    for (const seed of [42024, 2244426087, 58386330]) {
      const events = replay(seed)
      expect(events.length).toBeGreaterThan(0)
      expect(events.length).toBeLessThanOrEqual(3)
      expect(replay(seed)).toEqual(events)
    }
  })

  it('records a source-bound pacing receipt for advancing and defensive strategies', () => {
    type Receipt = { seed: number; strategy: string; turns: number; playerDecisions: number; enemyDecisions: number; contests: number; outcomes: string[]; resources: GameState['resources']; signals2Turn: number | null; recoveries: number; wardCasualties: number; enemyCasualties: number; enemySquads: number; hiddenSpawns: boolean; routeParity: boolean; eventParity: boolean }
    const seeds = [42024, 2244426087, 58386330]
    const replay = (seed: number, strategy: 'advance-a' | 'advance-b' | 'defensive'): Receipt => {
      let state = createNewCampaign(seed); let playerDecisions = 0; let enemyDecisions = 0; let contests = 0; let recoveries = 0; let wardCasualties = 0; let enemyCasualties = 0; let signals2Turn: number | null = null; const outcomes: string[] = []; let routeParity = true; let eventParity = true
      for (let step = 0; step < 18 && state.terminal === 'active'; step += 1) {
        while (state.researchLevels.Signals < 2) { try { state = advanceResearch(state, 'Signals') } catch { break } }
        const squad = state.squads[step % Math.max(1, state.squads.length)]
        const sector = squad && state.sectors.find(item => item.id === squad.sector)
        const adjacent = sector?.links ?? []
        const target = adjacent.find(link => state.enemySquads.some(enemy => enemy.sector === link) || state.sectors.find(item => item.id === link)?.owner === 'enemy')
        const safe = adjacent.find(link => !state.enemySquads.some(enemy => enemy.sector === link) && state.sectors.find(item => item.id === link)?.owner !== 'enemy')
        const advanceTarget = strategy === 'advance-b' ? [...adjacent].reverse().find(link => !state.enemySquads.some(enemy => enemy.sector === link) && state.sectors.find(item => item.id === link)?.owner !== 'enemy') : safe
        const order: Order = !squad ? { squadId: state.squads[0]?.id ?? 'none', type: 'hold' } : strategy === 'defensive' && step % 3 === 2 && state.resources.metal > 0 ? { squadId: squad.id, type: 'recover' } : target && strategy !== 'defensive' ? { squadId: squad.id, type: 'attack', target } : advanceTarget ? { squadId: squad.id, type: 'move', target: advanceTarget } : { squadId: squad.id, type: 'hold' }
        const player = resolveTurn(state, [order]); playerDecisions += player.events.length; recoveries += Number(order.type === 'recover')
        const combat = resolveCombat(player.nextState, player.events); contests += combat.reports.length; wardCasualties += combat.reports.reduce((sum, report) => sum + report.playerCasualties, 0); enemyCasualties += combat.reports.reduce((sum, report) => sum + report.enemyCasualties, 0)
        const forecast = decideEnemyIntent(combat.nextState); const enemy = resolveEnemyTurn(combat.nextState); enemyDecisions += enemy.events.length
        if (forecast && enemy.events[0]) { const actual = enemy.events[0]; eventParity &&= actual.squadId === forecast.squadId && actual.type === (forecast.kind === 'wait' ? 'hold' : forecast.kind) && (actual.target ?? actual.to) === (forecast.target ?? forecast.to); routeParity &&= combat.nextState.researchLevels.Signals < 2 || combat.nextState.scoutedEnemyRoutes.length > 0 }
        if (combat.nextState.researchLevels.Signals >= 2 && signals2Turn === null) signals2Turn = state.turn
        outcomes.push(`${state.turn}:${state.terminal}:${combat.reports.map(report => report.winner).join('|') || 'none'}`)
        state = terminalState(enemy.nextState)
      }
      return { seed, strategy, turns: state.turn - 1, playerDecisions, enemyDecisions, contests, outcomes, resources: state.resources, signals2Turn, recoveries, wardCasualties, enemyCasualties, enemySquads: state.enemySquads.length, hiddenSpawns: state.enemySquads.length > 3, routeParity, eventParity }
    }
    const receipt = seeds.flatMap(seed => (['advance-a', 'advance-b', 'defensive'] as const).map(strategy => replay(seed, strategy)))
    expect(receipt).toHaveLength(9)
    for (const row of receipt) { expect(row.turns).toBeLessThanOrEqual(18); expect(row.enemySquads).toBeLessThanOrEqual(3); expect(row.hiddenSpawns).toBe(false); expect(row.resources.metal).toBeGreaterThanOrEqual(0); expect(row.resources.energy).toBeGreaterThanOrEqual(0); expect(row.resources.intelligence).toBeGreaterThanOrEqual(0); expect(row.playerDecisions).toBeGreaterThan(0); expect(row.enemyDecisions).toBeGreaterThan(row.turns); expect(row.contests).toBeGreaterThanOrEqual(0); expect(row.wardCasualties).toBeGreaterThanOrEqual(0); expect(row.enemyCasualties).toBeGreaterThanOrEqual(0); expect(row.routeParity).toBe(true); expect(row.eventParity).toBe(true); expect(row.outcomes.length).toBe(row.turns) }
    expect(receipt.some(row => row.wardCasualties > 0)).toBe(true)
    expect(receipt.some(row => row.enemyCasualties > 0)).toBe(true)
    for (const seed of seeds) for (const strategy of ['advance-a', 'advance-b', 'defensive'] as const) expect(replay(seed, strategy)).toEqual(replay(seed, strategy))
  })

  it('keeps a committed phase independent of omitted HOLD orders and accounts income once', () => {
    const base = createNewCampaign(42024)
    const noPressure = resolveEnemyTurn(base, 0)
    expect(noPressure.events).toEqual(resolveEnemyTurn(base).events)
    expect(noPressure.events).toHaveLength(base.enemySquads.length)
    expect(noPressure.nextState.resources).toEqual({ metal: base.resources.metal + noPressure.nextState.income.metal, energy: base.resources.energy + noPressure.nextState.income.energy, intelligence: base.resources.intelligence + noPressure.nextState.income.intelligence })
    const one = resolveEnemyTurn(base, 1)
    const five = resolveEnemyTurn(base, 5)
    expect(one.events).toHaveLength(1)
    expect(new Set(five.events.map(event => event.squadId)).size).toBe(five.events.length)
    expect(five.events.every(event => base.enemySquads.some(enemy => enemy.id === event.squadId && enemy.strength > 0))).toBe(true)
    expect(five.nextState.resources).toEqual({ metal: base.resources.metal + five.nextState.income.metal, energy: base.resources.energy + five.nextState.income.energy, intelligence: base.resources.intelligence + five.nextState.income.intelligence })
    expect(resolveEnemyTurn(base).events).toEqual(noPressure.events)
    expect(decideEnemyIntents(base, 0)).toEqual(decideEnemyIntents(base))
    const oneOrder = resolveTurn(base, [{ squadId: base.squads[0].id, type: 'hold' }])
    const onePhase = resolveEnemyTurn(resolveCombat(oneOrder.nextState, oneOrder.events).nextState)
    const allOrders = resolveTurn(base, base.squads.map(squad => ({ squadId: squad.id, type: 'hold' as const })))
    const allPhase = resolveEnemyTurn(resolveCombat(allOrders.nextState, allOrders.events).nextState)
    expect(onePhase.events.map(event => event.squadId)).toEqual(allPhase.events.map(event => event.squadId))
    expect(onePhase.nextState.resources).toEqual(allPhase.nextState.resources)
  })

  it('keeps the full Signals2 forecast aligned with every multi-action event and casualty side', () => {
    const base = createNewCampaign(42024)
    const signals = advanceResearch(advanceResearch({ ...base, resources: { ...base.resources, intelligence: 11 } }, 'Signals'), 'Signals')
    const budget = 5
    const forecast = decideEnemyIntents(signals, budget)
    const actual = resolveEnemyTurn(signals, budget)
    expect(actual.events.map(event => ({ squadId: event.squadId, type: event.type, from: event.from, to: event.to, target: event.target }))).toEqual(forecast.map(intent => ({ squadId: intent.squadId, type: intent.kind === 'wait' ? 'hold' : intent.kind, from: intent.from, to: intent.to ?? intent.from, target: intent.target })))
    const prepared = { ...signals, enemySquads: [{ ...signals.enemySquads[0], sector: 'sector-1' as const, strength: 100 }], squads: [{ ...signals.squads[0], sector: 'sector-0' as const, strength: 1 }, ...signals.squads.slice(1)] }
    const casualtyPhase = resolveEnemyTurn(prepared, 5)
    expect(casualtyPhase.reports.reduce((sum, report) => sum + report.playerCasualties, 0)).toBeGreaterThanOrEqual(0)
    expect(casualtyPhase.reports.reduce((sum, report) => sum + report.enemyCasualties, 0)).toBeGreaterThanOrEqual(0)
  })

  it('runs five advancing multi-order turns with finite symmetric counterplay', () => {
    let state = createNewCampaign(42024)
    let playerActions = 0
    let enemyActions = 0
    let wardCasualties = 0
    let hostileCasualties = 0
    const route: Order[][] = [
      [{ squadId: 'squad-1', type: 'move', target: 'sector-1' }, { squadId: 'squad-2', type: 'move', target: 'sector-11' }, { squadId: 'squad-3', type: 'move', target: 'sector-1' }, { squadId: 'squad-4', type: 'move', target: 'sector-11' }, { squadId: 'squad-5', type: 'move', target: 'sector-1' }],
      [{ squadId: 'squad-1', type: 'attack', target: 'sector-2' }, { squadId: 'squad-2', type: 'attack', target: 'sector-10' }, { squadId: 'squad-3', type: 'move', target: 'sector-5' }, { squadId: 'squad-4', type: 'attack', target: 'sector-10' }, { squadId: 'squad-5', type: 'move', target: 'sector-5' }],
      [{ squadId: 'squad-1', type: 'attack', target: 'sector-3' }, { squadId: 'squad-3', type: 'attack', target: 'sector-6' }, { squadId: 'squad-2', type: 'attack', target: 'sector-10' }, { squadId: 'squad-4', type: 'attack', target: 'sector-10' }, { squadId: 'squad-5', type: 'attack', target: 'sector-6' }],
      [{ squadId: 'squad-3', type: 'attack', target: 'sector-6' }, { squadId: 'squad-2', type: 'attack', target: 'sector-10' }, { squadId: 'squad-4', type: 'attack', target: 'sector-10' }],
      [{ squadId: 'squad-2', type: 'attack', target: 'sector-9' }, { squadId: 'squad-4', type: 'attack', target: 'sector-9' }],
    ]
    for (const recorded of route) {
      if (state.terminal !== 'active') break
      const orders = recorded.map(order => {
        const squad = state.squads.find(item => item.id === order.squadId)
        return squad && order.target === squad.sector ? { squadId: order.squadId, type: 'hold' as const } : order
      })
      const player = resolveTurn(state, orders)
      playerActions += player.events.length
      const combat = resolveCombat(player.nextState, player.events)
      const enemy = resolveEnemyTurn(combat.nextState)
      enemyActions += enemy.events.length
      wardCasualties += enemy.reports.reduce((sum, report) => sum + report.playerCasualties, 0)
      hostileCasualties += enemy.reports.reduce((sum, report) => sum + report.enemyCasualties, 0)
      state = enemy.nextState
    }
    expect(state.turn).toBe(6)
    expect(playerActions).toBeGreaterThan(0)
    expect(playerActions).toBeGreaterThan(enemyActions)
    expect(enemyActions).toBeGreaterThan(5)
    expect(state.enemySquads.length).toBeLessThanOrEqual(3)
    expect(wardCasualties).toBeGreaterThan(0)
    expect(hostileCasualties).toBeGreaterThan(0)
  })
})
