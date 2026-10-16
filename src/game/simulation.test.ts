import { describe, expect, it } from 'vitest'
import { advanceDay, createNewCampaign, initialCampaign, resolveTurn, validateOrders, type Order } from './simulation'

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
  it('rejects multiple attacks when their total energy cost is unaffordable', () => {
    const game = createNewCampaign(3)
    const lowEnergy = { ...game, resources: { ...game.resources, energy: 2 } }
    const orders: Order[] = [{ squadId: 'squad-1', type: 'attack', target: 'sector-1' }, { squadId: 'squad-2', type: 'attack', target: 'sector-1' }]
    expect(() => resolveTurn(lowEnergy, orders)).toThrow(/energy/)
    expect(lowEnergy.resources.energy).toBe(2)
    expect(lowEnergy.squads.map(squad => squad.sector)).toEqual(['sector-0', 'sector-0', 'sector-0', 'sector-0', 'sector-0'])
  })
  it('rejects multiple recoveries when their total metal cost is unaffordable', () => {
    const game = createNewCampaign(4)
    const lowMetal = { ...game, resources: { ...game.resources, metal: 1 } }
    const orders: Order[] = [{ squadId: 'squad-1', type: 'recover' }, { squadId: 'squad-2', type: 'recover' }]
    expect(() => resolveTurn(lowMetal, orders)).toThrow(/metal/)
    expect(lowMetal.resources.metal).toBe(1)
    expect(lowMetal.squads.map(squad => squad.strength)).toEqual([10, 10, 10, 10, 10])
  })
})
