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
