import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from './App'

describe('App interactions', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('switches to field notes and advances the campaign day', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const root = createRoot(document.getElementById('root')!)

    await act(async () => root.render(<App />))
    const buttons = [...document.querySelectorAll('button')]
    await act(async () => (buttons[1] as HTMLButtonElement).click())
    expect(document.body.textContent).toContain('FIELD NOTES')

    await act(async () => (buttons[0] as HTMLButtonElement).click())
    await act(async () => (document.querySelector('.primary') as HTMLButtonElement).click())
    expect(document.body.textContent).toContain('Day2')
    expect(document.body.textContent).toContain('Supplies2')

    await act(async () => root.unmount())
  })
})
