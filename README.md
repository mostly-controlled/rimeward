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

## Static hosting readiness

Vite is configured with a relative asset base (`./`), so the generated `dist/` directory
can be served from a GitHub Pages project subpath without rewriting asset URLs. This
repository currently has no Pages workflow or enabled Pages deployment, so no public URL
is claimed yet. Enabling Pages with the GitHub Actions source requires repository workflow
permission; the deployment workflow is intentionally deferred until that repository-level
setting is authorized.

This remains a local browser run only; no hosted URL or post-AI campaign acceptance is claimed here.

## Short delivery guide

1. Install and run locally: `npm ci`, then `npm run dev`. Open the local Vite URL and use the normal new-campaign chooser; there is no seed-entry field.
2. Each turn assigns at most one action to each living Ward squad. Orders are validated as a batch; an invalid batch spends nothing. `HOLD` is free, `ATTACK` costs `2 metal + 3 energy`, and `RECOVER` costs `6 metal + 2 energy` (with Logistics affecting recovery amount/cap, not this base cost).
3. Income is paid only by Ward-owned sectors connected to HQ. The turn rail reports connected income/supply, order costs, enemy response, and the resulting resource deltas. Research is paid from the shown branch cost and threshold.
4. Completed turns and research are autosaved locally. On reload choose `CONTINUE`; queued orders are not saved. `VERIFY REPLAY` replays the saved ordered journal when its rules and journal versions are supported. If a saved campaign uses incompatible replay rules, replay is unavailable but the campaign can still continue and save. `RESET SAME SEED` starts the current seed over; `NEW CAMPAIGN · NEW SEED` creates a fresh seed.
5. Victory requires all three relays and enemy HQ capture. A campaign can lose through enemy capture of the Ward HQ, destruction of all Ward squads, or reaching the turn limit without victory.

Validation: `npm run check`, `npm test -- --run`, and `npm run build`.
