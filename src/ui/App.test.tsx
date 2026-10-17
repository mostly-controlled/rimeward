import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from './App'
import { advanceResearch, createNewCampaign, terminalState } from '../game/simulation'

describe('App interactions', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('selects a tactical target and executes the turn', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const root = createRoot(document.getElementById('root')!)

    await act(async () => root.render(<App />))
    const buttons = [...document.querySelectorAll('button')]
    await act(async () => (buttons[1] as HTMLButtonElement).click())
    expect(document.body.textContent).toContain('FIELD NOTES')

    await act(async () => (buttons[0] as HTMLButtonElement).click())
    const target = document.querySelector('[role="button"][aria-label*="Whiteplain"]') as SVGGElement
    await act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(document.body.textContent).toContain('MOVE')
    await act(async () => (document.querySelector('.execute') as HTMLButtonElement).click())
    expect(document.body.textContent).toContain('squad-1 move sector-1')
    expect(document.querySelector('.turn-readout')?.textContent).toContain('02')

    await act(async () => root.unmount())
  })

  it('uses the selected action for neutral targets and exposes keyboard selection', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const root = createRoot(document.getElementById('root')!)

    await act(async () => root.render(<App />))
    const attack = [...document.querySelectorAll('button')].find(button => button.textContent === 'ATTACK') as HTMLButtonElement
    await act(async () => attack.click())
    expect(attack.getAttribute('aria-pressed')).toBe('true')

    const target = document.querySelector('[role="button"][aria-label*="Whiteplain"]') as SVGGElement
    expect(target.getAttribute('aria-label')).toContain('attack target')
    await act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })))
    expect((document.querySelector('.execute') as HTMLButtonElement).disabled).toBe(false)
    expect(document.querySelector('.order-active')?.textContent).toBe('ATTACK')

    await act(async () => root.unmount())
  })

  it('renders the latest typed battle report between orders and events, retains it, and resets it', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const root = createRoot(document.getElementById('root')!)
    const clickSector = async (name: string) => {
      const sector = document.querySelector(`[role="button"][aria-label*="${name}"]`) as SVGGElement
      expect(sector).not.toBeNull()
      await act(async () => sector.dispatchEvent(new MouseEvent('click', { bubbles: true })))
      await act(async () => (document.querySelector('.execute') as HTMLButtonElement).click())
    }

    await act(async () => root.render(<App />))
    const initialSidebar = [...document.querySelector('.side-panel')!.children].map(node => node.className)
    expect(initialSidebar).toEqual(['card squad-panel', 'card orders', 'card event-rail'])
    expect(document.querySelector('.seed-readout')?.textContent).toBe('SEED 42024')
    expect(document.querySelector('.turn-readout')?.textContent).toContain('NEW CAMPAIGN')

    await clickSector('Whiteplain')
    await clickSector('Glassway')
    await act(async () => ([...document.querySelectorAll('button')].find(button => button.textContent === 'ATTACK') as HTMLButtonElement).click())
    await clickSector('Ashenfall')

    expect(document.querySelector('.event-rail')?.textContent).toContain('squad-1 attack sector-6')
    const report = document.querySelector('.reports')
    expect(report?.textContent).toContain('BATTLE REPORT')
    expect(report?.textContent).toContain('Ashenfall')
    expect(report?.textContent).toMatch(/ATTACKER/)
    expect(report?.textContent).toMatch(/DEFENDER/)
    expect(report?.textContent).toMatch(/Terrain .* ×.* · fatigue −.* · variance/)
    expect(report?.textContent).toContain('casualty entries')
    expect(report?.textContent).toMatch(/retreat|Retreat/)
    expect(report?.textContent).toMatch(/Captured|Not captured/)
    expect(report?.parentElement?.className).toBe('side-panel')
    expect(report?.nextElementSibling?.classList.contains('squad-panel')).toBe(true)
    expect(report?.nextElementSibling?.nextElementSibling?.classList.contains('orders')).toBe(true)
    expect(report?.nextElementSibling?.nextElementSibling?.nextElementSibling?.classList.contains('event-rail')).toBe(true)
    expect([...report!.parentElement!.children].map(node => node.className)).toEqual(['reports card', 'card squad-panel', 'card orders', 'card event-rail'])

    const latestReport = report?.textContent
    await act(async () => ([...document.querySelectorAll('button')].find(button => button.textContent === 'HOLD') as HTMLButtonElement).click())
    await act(async () => (document.querySelector('.execute') as HTMLButtonElement).click())
    expect(document.querySelector('.reports')?.textContent).toContain('BATTLE REPORT')

    await act(async () => ([...document.querySelectorAll('button')].find(button => button.textContent === 'NEW CAMPAIGN') as HTMLButtonElement).click())
    expect(document.querySelector('.reports')).toBeNull()
    expect(document.querySelector('.event-rail')?.textContent).toContain('Awaiting first orders...')

    await act(async () => root.unmount())
  })
  it('preserves the original turn of player, enemy, and battle events across turns', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const root = createRoot(document.getElementById('root')!)
    const entries = () => [...document.querySelectorAll('.event-rail p')].map(entry => ({
      turn: entry.querySelector('span')?.textContent,
      message: entry.lastChild?.textContent,
    }))
    const executeTarget = async (name: string) => {
      const target = document.querySelector(`[role="button"][aria-label*="${name}"]`) as SVGGElement
      await act(async () => target.dispatchEvent(new MouseEvent('click', { bubbles: true })))
      await act(async () => (document.querySelector('.execute') as HTMLButtonElement).click())
    }

    await act(async () => root.render(<App />))
    await executeTarget('Whiteplain')
    const firstTurn = entries()
    expect(firstTurn).toHaveLength(2)
    expect(firstTurn.every(entry => entry.turn === '01')).toBe(true)
    expect(firstTurn.some(entry => entry.message?.startsWith('enemy-'))).toBe(true)
    expect(firstTurn).toContainEqual({ turn: '01', message: 'squad-1 move sector-1' })

    await executeTarget('Glassway')
    expect(entries().slice(0, 2).every(entry => entry.turn === '02')).toBe(true)
    expect(entries().slice(2)).toEqual(firstTurn)
    await act(async () => ([...document.querySelectorAll('button')].find(button => button.textContent === 'ATTACK') as HTMLButtonElement).click())
    await executeTarget('Ashenfall')
    const battleTurn = entries()
    expect(battleTurn[0].message).toMatch(/^sector-6 .* casualty entries$/)
    expect(battleTurn.slice(0, 3).every(entry => entry.turn === '03')).toBe(true)
    expect(battleTurn.slice(-2)).toEqual(firstTurn)

    await act(async () => ([...document.querySelectorAll('button')].find(button => button.textContent === 'HOLD') as HTMLButtonElement).click())
    await act(async () => (document.querySelector('.execute') as HTMLButtonElement).click())
    expect(entries().slice(0, 2).every(entry => entry.turn === '04')).toBe(true)
    const afterEnemyPhase = entries()
    expect(afterEnemyPhase.slice(-battleTurn.length)).toEqual(battleTurn)
    expect(afterEnemyPhase.filter(entry => entry.turn === '04').length).toBeGreaterThanOrEqual(2)
    expect(entries().some(entry => entry.turn === '04' && entry.message === 'enemy-2 assaults Frostgate')).toBe(true)
    expect(document.querySelector('.turn-readout strong')?.textContent).toBe('05')

    await act(async () => root.unmount())
  })

  it('keeps commands bound to a displayed live squad selection', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<App />))
    const squadCards = [...document.querySelectorAll('.squad-card')]
    expect(squadCards).toHaveLength(5)
    expect(document.querySelector('.selection-note')?.textContent).toContain('Frostgate')
    await act(async () => root.unmount())
  })

  it("renders the no-survivors state for a zero-player-squad campaign", async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const root = createRoot(document.getElementById("root")!)
    const campaign = createNewCampaign(42024)
    await act(async () => root.render(<App initialGame={{ ...campaign, squads: [] }} />))
    expect(document.body.textContent).toContain("NO SURVIVORS")
    expect(document.body.textContent).toContain("no active squads")
    await act(async () => root.unmount())
  })

  it('selects research, charges its real cost, and shows all two-level controls', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<App />))
    const logistics = [...document.querySelectorAll('.research button')].find(button => button.textContent?.includes('Logistics')) as HTMLButtonElement
    await act(async () => logistics.click())
    expect(logistics.textContent).toContain('1/2')
    expect(document.body.textContent).toContain('LVL 2')
    expect(document.querySelectorAll('.research button')).toHaveLength(3)
    await act(async () => root.unmount())
  })

  it('blocks terminal orders and permits restart', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const root = createRoot(document.getElementById('root')!)
    const terminal = terminalState({ ...createNewCampaign(7), squads: [], terminal: 'active' })
    await act(async () => root.render(<App initialGame={terminal} />))
    expect(document.body.textContent).toContain('NO SURVIVORS')
    await act(async () => (document.querySelector('.primary') as HTMLButtonElement).click())
    expect(document.body.textContent).toContain('SEED 7')
    await act(async () => root.unmount())
  })

  it('selects research, spends its real cost, and shows HQ-connected income sources', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<App />))
    expect(document.querySelector('.income')?.textContent).toContain('Frostgate: +1M +0E +1I')
    expect(document.querySelector('.income')?.textContent).toContain('TOTAL +1M +0E +1I / TURN')
    const logistics = [...document.querySelectorAll('.research button')].find(button => button.textContent?.includes('Logistics')) as HTMLButtonElement
    expect(logistics.textContent).toContain('LVL 1')
    await act(async () => logistics.click())
    expect(logistics.textContent).toContain('1/2')
    expect(logistics.textContent).toContain('LVL 2')
    await act(async () => root.unmount())
  })

  it('renders Signals identities, classes, sector names, and tier2 route candidates', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const root = createRoot(document.getElementById('root')!)
    const seedGame = createNewCampaign(42024)
    const tier1 = advanceResearch({ ...seedGame, resources: { ...seedGame.resources, intelligence: 11 } }, 'Signals')
    await act(async () => root.render(<App initialGame={tier1} />))
    const intel = document.querySelector('.intel')!
    const enemy = tier1.enemySquads[0]
    expect(intel.textContent).toContain(enemy.id)
    expect(intel.textContent).toContain(enemy.class.toUpperCase())
    expect(intel.textContent).toContain(tier1.sectors.find(sector => sector.id === enemy.sector)!.name)
    const tier2 = advanceResearch(tier1, 'Signals')
    expect(tier2.researchLevels.Signals).toBe(2)
    expect(tier2.scoutedEnemyRoutes.length).toBeGreaterThan(0)
    await act(async () => root.unmount())
    const tier2Root = createRoot(document.getElementById('root')!)
    await act(async () => tier2Root.render(<App initialGame={tier2} />))
    expect(document.querySelector('.intel')?.textContent).toContain('ROUTE INTENTS:')
    expect(document.querySelector('.intel')?.textContent).toContain('advances to')
    expect(document.querySelector('.research-effects')?.textContent).toContain('legal route intents')
    await act(async () => tier2Root.unmount())
  })

  it('blocks terminal orders and offers a restart', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const root = createRoot(document.getElementById('root')!)
    const campaign = createNewCampaign(42)
    await act(async () => root.render(<App initialGame={{ ...campaign, turn: 19, terminal: 'defeat', terminalReason: 'Turn 18 reached without victory.' }} />))
    expect(document.querySelector('.terminal')?.textContent).toContain('TURN 18 — DEFEAT')
    expect((document.querySelector('.execute') as HTMLButtonElement).disabled).toBe(true)
    expect([...document.querySelectorAll('.research button')].every(button => (button as HTMLButtonElement).disabled)).toBe(true)
    await act(async () => ([...document.querySelectorAll('.terminal button')].find(button => button.textContent?.startsWith('RESTART')) as HTMLButtonElement).click())
    expect(document.querySelector('.terminal')).toBeNull()
    expect(document.querySelector('.turn-readout strong')?.textContent).toBe('01')
    await act(async () => root.unmount())
  })
})
