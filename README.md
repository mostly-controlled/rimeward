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

## Short delivery guide

1. Install and run: `npm ci`, then `npm run dev`. Open the local Vite URL and choose `NEW CAMPAIGN · NEW SEED` (or enter a known seed in the terminal screen).
2. Each turn assigns at most one action to each living Ward squad. Orders are validated as a batch; an invalid batch spends nothing. `HOLD` is free, `ATTACK` costs `2 metal + 3 energy`, and supplied `RECOVER` costs the displayed metal amount plus `2 energy`.
3. Income is paid only by Ward-owned sectors connected to HQ. The turn rail reports connected income/supply, order costs, enemy response, and the resulting resource deltas. Research is paid from the shown branch cost and threshold.
4. Use `SAVE CAMPAIGN` after completed turns or research. Queued orders are not saved. On reload choose `CONTINUE SAVED CAMPAIGN`; `VERIFY REPLAY` replays the saved ordered journal for the same seed. `RESET SAME SEED` starts that seed over; `NEW CAMPAIGN · NEW SEED` derives a new seed.
5. Terminal campaigns cannot accept more orders. A campaign can lose through HQ capture, destruction of all Ward squads, or reaching the turn limit without all relays.

Validation: `npm run check`, `npm test -- --run`, and `npm run build`.
