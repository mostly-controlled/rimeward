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
can be served from a GitHub Pages project subpath without rewriting asset URLs. Pages is
optional and is not required for the existing Vercel path.

Verified release receipt — 22 October 2026 (PR #50): the live public URL is
<https://rimeward-preview.vercel.app>. This dated release was verified against source
`69e084754d990771908e10887ba934d3c06837c1`; the exact deployment receipt is
`dpl_Ef8S4es1f92MfPK2xUtLs8mSFwRb READY`. A cookie-free public HTTP request returned `200`.

Historical hosted acceptance: a personally played hosted seed `42024` reached victory at T6. A
midrun refresh and terminal refresh both matched Continue/replay, and no console errors
were observed. The trace for `4132161419` is **victory T6**: T1-T3 are the causal route,
followed by the T4 switch. This is a victory-at-T6 trace, not a seed string with T6.

M2 limits remain: this is a narrow hosted smoke/acceptance record, not broad browser,
device, accessibility, performance, or long-run reliability coverage. The evidence
supports closing #45 only; #46 and #7 remain open. The reviewed Pages workflow remains
optional and is not required for the existing Vercel deployment.

## Short delivery guide

1. Install and run locally: `npm ci`, then `npm run dev`. Open the local Vite URL and use the normal new-campaign chooser; there is no seed-entry field.
2. Each turn assigns at most one action to each living Ward squad. Orders are validated as a batch; an invalid batch spends nothing. `HOLD` is free, `ATTACK` costs `2 metal + 3 energy`, and `RECOVER` costs `6 metal + 2 energy` (with Logistics affecting recovery amount/cap, not this base cost).
3. Income is paid only by Ward-owned sectors connected to HQ. The turn rail reports connected income/supply, order costs, enemy response, and the resulting resource deltas. Research is paid from the shown branch cost and threshold.
4. Completed turns and research are autosaved locally. On reload choose `CONTINUE`; queued orders are not saved. `VERIFY REPLAY` replays the saved ordered journal when its rules and journal versions are supported. If a saved campaign uses incompatible replay rules, replay is unavailable but the campaign can still continue and save. `RESET SAME SEED` starts the current seed over; `NEW CAMPAIGN · NEW SEED` creates a fresh seed.
5. Victory requires all three relays and enemy HQ capture. A campaign can lose through enemy capture of the Ward HQ, destruction of all Ward squads, or reaching the turn limit without victory.

Validation: `npm run check`, `npm test -- --run`, and `npm run build`.
