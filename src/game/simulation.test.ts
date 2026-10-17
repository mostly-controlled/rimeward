import { describe, expect, it } from 'vitest'
import { advanceDay, createNewCampaign, initialCampaign, resolveCombat, resolveEnemyTurn, resolveTurn, validateOrders, type Order } from './simulation'

describe('campaign simulation', () => {
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
    expect(result.reports[0].attackers[0].units).toBe(14)
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
})
