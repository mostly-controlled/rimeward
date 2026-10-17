import { describe, expect, it } from 'vitest'
import { advanceDay, advanceResearch, calculateIncome, connectedOwnedSectors, createNewCampaign, initialCampaign, resolveCombat, resolveEnemyTurn, resolveTurn, decideEnemyIntent, researchCost, terminalState, validateOrders, type Order } from './simulation'

describe('campaign simulation', () => {

  it('advances each research branch exactly twice with branch-specific costs and effects', () => {
    const game = createNewCampaign(42)
    expect(researchCost('Logistics', 0)).toEqual({ metal: 2, energy: 0, intelligence: 0 })
    expect(researchCost('Warfare', 1)).toEqual({ metal: 0, energy: 3, intelligence: 0 })
    expect(researchCost('Signals', 1)).toEqual({ metal: 0, energy: 0, intelligence: 3 })
    const logistics = advanceResearch(game, 'Logistics')
    expect(logistics.researchLevels.Logistics).toBe(1)
    expect(logistics.resources).toEqual({ metal: 18, energy: 20, intelligence: 5 })
    expect(() => advanceResearch(advanceResearch(logistics, 'Logistics'), 'Logistics')).toThrow(/complete/)
    const warfare = advanceResearch(game, 'Warfare')
    const signals = advanceResearch(game, 'Signals')
    expect(warfare.resources.energy).toBe(18)
    expect(signals.resources.intelligence).toBe(3)
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
    const tierOne = advanceResearch(game, 'Signals')
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
    expect(captured.nextState.sectors.find(sector => sector.id === 'sector-1')?.owner).toBe('enemy')
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


  it('proves a seeded legal order route reaches victory through all three relays', () => {
    let state = createNewCampaign(42024)
    const route: Order[][] = [
      [{ squadId: 'squad-1', type: 'move', target: 'sector-1' }, { squadId: 'squad-2', type: 'move', target: 'sector-11' }, { squadId: 'squad-3', type: 'move', target: 'sector-1' }, { squadId: 'squad-4', type: 'move', target: 'sector-11' }, { squadId: 'squad-5', type: 'move', target: 'sector-1' }],
      [{ squadId: 'squad-1', type: 'move', target: 'sector-2' }, { squadId: 'squad-2', type: 'attack', target: 'sector-10' }, { squadId: 'squad-3', type: 'move', target: 'sector-5' }, { squadId: 'squad-4', type: 'attack', target: 'sector-10' }, { squadId: 'squad-5', type: 'move', target: 'sector-5' }],
      [{ squadId: 'squad-1', type: 'attack', target: 'sector-3' }, { squadId: 'squad-3', type: 'attack', target: 'sector-6' }, { squadId: 'squad-2', type: 'attack', target: 'sector-10' }, { squadId: 'squad-4', type: 'attack', target: 'sector-10' }, { squadId: 'squad-5', type: 'attack', target: 'sector-6' }],
      [{ squadId: 'squad-3', type: 'attack', target: 'sector-6' }, { squadId: 'squad-2', type: 'attack', target: 'sector-10' }, { squadId: 'squad-4', type: 'attack', target: 'sector-10' }],
      [{ squadId: 'squad-2', type: 'attack', target: 'sector-9' }, { squadId: 'squad-4', type: 'attack', target: 'sector-9' }],
    ]
    for (const orders of route) { const turn = resolveTurn(state, orders); const combat = resolveCombat(turn.nextState, turn.events); state = resolveEnemyTurn(combat.nextState).nextState }
    expect(state.objectives.every(objective => objective.controlled)).toBe(true)
    expect(state.terminal).toBe('victory')
    expect(state.orderHistory).toHaveLength(route.length)
  })

  it('loses deterministically on turn 18 after a legal hold order', () => {
    let state = createNewCampaign(42024)
    for (let index = 0; index < 18; index += 1) { const turn = resolveTurn(state, [{ squadId: 'squad-1', type: 'hold' }]); state = resolveEnemyTurn(turn.nextState).nextState }
    const result = resolveEnemyTurn(state)
    expect(result.nextState.terminal).toBe('defeat')
    expect(result.nextState.terminalReason).toBe('Turn 18 reached without victory.')
  })

  it('gives victory precedence when victory and defeat conditions become true together', () => {
    let state = createNewCampaign(42024)
    const route: Order[][] = [
      [{ squadId: 'squad-1', type: 'move', target: 'sector-1' }, { squadId: 'squad-2', type: 'move', target: 'sector-11' }, { squadId: 'squad-3', type: 'move', target: 'sector-1' }, { squadId: 'squad-4', type: 'move', target: 'sector-11' }, { squadId: 'squad-5', type: 'move', target: 'sector-1' }],
      [{ squadId: 'squad-1', type: 'move', target: 'sector-2' }, { squadId: 'squad-2', type: 'attack', target: 'sector-10' }, { squadId: 'squad-3', type: 'move', target: 'sector-5' }, { squadId: 'squad-4', type: 'attack', target: 'sector-10' }, { squadId: 'squad-5', type: 'move', target: 'sector-5' }],
      [{ squadId: 'squad-1', type: 'attack', target: 'sector-3' }, { squadId: 'squad-3', type: 'attack', target: 'sector-6' }, { squadId: 'squad-2', type: 'attack', target: 'sector-10' }, { squadId: 'squad-4', type: 'attack', target: 'sector-10' }, { squadId: 'squad-5', type: 'attack', target: 'sector-6' }],
      [{ squadId: 'squad-3', type: 'attack', target: 'sector-6' }, { squadId: 'squad-2', type: 'attack', target: 'sector-10' }, { squadId: 'squad-4', type: 'attack', target: 'sector-10' }],
      [{ squadId: 'squad-1', type: 'hold' }],
      [{ squadId: 'squad-1', type: 'hold' }],
      [{ squadId: 'squad-1', type: 'hold' }],
      [{ squadId: 'squad-2', type: 'attack', target: 'sector-9' }, { squadId: 'squad-4', type: 'attack', target: 'sector-9' }],
    ]
    const phaseTrace: string[] = []
    for (const orders of route) { const turn = resolveTurn(state, orders); const combat = resolveCombat(turn.nextState, turn.events); const enemy = resolveEnemyTurn(combat.nextState); phaseTrace.push(`turn=${state.turn} enemy=${enemy.events[0]?.to ?? 'none'} terminal=${enemy.nextState.terminal}`); state = enemy.nextState }
    expect(phaseTrace.at(-1)).toBe('turn=8 enemy=sector-4 terminal=victory')
    expect(state.terminal).toBe('victory')
    expect(state.terminalReason).toBe('All three relays secured.')
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


  it('makes Signals scouting progressively reveal concrete enemy information', () => {
    const base = createNewCampaign(42)
    expect(base.revealedEnemySquads).toEqual([])
    expect(base.scoutedEnemyRoutes).toEqual([])
    const tier1 = advanceResearch(base, 'Signals')
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
    const signals = advanceResearch(advanceResearch(game, 'Signals'), 'Signals')
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
    expect(decideEnemyIntent(blocked)?.kind).toBe('hold')
    const defended = { ...game, enemySquads: [{ ...enemy, sector: 'sector-1' as const }], squads: [{ ...game.squads[0], sector: 'sector-0' as const }, ...game.squads.slice(1).map(squad => ({ ...squad, sector: 'sector-11' as const }))] }
    expect(decideEnemyIntent(defended)?.kind).toBe('attack')
    const undefended = { ...defended, squads: defended.squads.map(squad => ({ ...squad, sector: 'sector-11' as const })) }
    expect(decideEnemyIntent(undefended)?.kind).toBe('move')
    expect(decideEnemyIntent(undefended)?.to).toBe('sector-0')
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
})
