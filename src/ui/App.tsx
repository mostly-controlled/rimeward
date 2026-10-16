import { useState } from 'react'
import { advanceDay, initialCampaign, type Campaign } from '../game/simulation'

export function App() {
  const [view, setView] = useState<'campaign' | 'field'>('campaign')
  const [campaign, setCampaign] = useState<Campaign>(initialCampaign)
  return <main className="shell">
    <header><p className="eyebrow">RIMEWARD // NORTHERN FRONTIER</p><h1>Hold the white line.</h1><p className="lede">A quiet strategy shell for a world frozen at the edge of the map.</p></header>
    <nav aria-label="Main navigation"><button className={view === 'campaign' ? 'active' : ''} onClick={() => setView('campaign')}>Campaign</button><button className={view === 'field' ? 'active' : ''} onClick={() => setView('field')}>Field notes</button></nav>
    {view === 'campaign' ? <section className="card"><div><p className="eyebrow">CURRENT EXPEDITION</p><h2>The thawline watch</h2><p>Scout the ice shelf, ration the last supplies, and keep the ward lit through the long night.</p></div><dl><div><dt>Day</dt><dd>{campaign.day}</dd></div><div><dt>Supplies</dt><dd>{campaign.supplies}</dd></div></dl><button className="primary" onClick={() => setCampaign(advanceDay(campaign))}>Begin next watch</button></section> : <section className="card"><p className="eyebrow">FIELD NOTES</p><h2>Nothing moves without a reason.</h2><p>The campaign map and encounter systems will arrive in later issues. This shell keeps presentation separate from the deterministic game module.</p></section>}
  </main>
}
