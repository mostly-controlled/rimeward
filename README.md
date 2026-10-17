# Rimeward

Minimal browser strategy-game shell: React + TypeScript + Vite, with a deterministic DOM-free game module in `src/game/` and presentation in `src/ui/` (the initial shell remains in `src/main.tsx`).

## Run locally

```sh
npm ci
npm run dev
```

For validation:

```sh
npm run check
npm test -- --run
npm run build
```

This issue intentionally excludes backend services, authentication, persistence, remote assets, desktop packaging, and browser automation. Gameplay systems arrive in later issues.

## Concrete campaign paths

- **Winning path:** from seed `42024`, move `squad-1` through `Whiteplain` and `Glassway`, attack and capture `Ashenfall`, then repeat the same supplied, adjacent advance-and-attack pattern for the other two relay sectors. A relay counts only after its sector is held by the Ward; capture does not teleport the squad or grant an undefended objective for free.
- **Losing paths:** allow an enemy squad to advance through adjacent legal links until it captures the Ward HQ, let all Ward squads be destroyed, or reach turn 18 without all three relays. Terminal state is checked after the enemy phase, and further orders/research are blocked.
- **Economy:** income comes only from player-owned sectors connected to the HQ. Captured or cut-off sectors stop yielding their explicit metal, energy, and intelligence values until the link is restored. Recover costs one metal and attacks cost two energy; rejected multi-order batches spend nothing.
- **Replay:** recreate the campaign with the same seed and submit the same ordered commands. Enemy movement, battle variance, research effects, and resource totals are deterministic; a different seed is available from the terminal screen.
