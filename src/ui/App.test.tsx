import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from './App'

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
})
