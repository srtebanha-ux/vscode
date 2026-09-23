# 🌮 Taco Together

A cooperative taco-cooking game (in the spirit of *Papa's Taco Mia* / *Overcooked*)
built **entirely in Claude Code** — every pixel of art is drawn with Canvas paths
and every sound is synthesized with the Web Audio API. There are **zero binary
assets**: the whole game is text (`.ts` / `.html`), which is exactly what makes it
buildable start-to-finish by an AI coding agent.

> Status: **Phase 1** — a fully playable single-player prototype. Local 2-player
> and online P2P (WebRTC) are on the roadmap. See [`GAME_DESIGN.md`](./GAME_DESIGN.md).

## Play

```bash
cd taco-together
npm install
npm run dev
# open the printed http://localhost:5173 URL
```

Build a static bundle instead:

```bash
npm run build      # outputs to dist/
npm run preview
```

## How to play

You run a taco stand. Customers appear at the top with an order (a cooked patty
plus some toppings) and a patience bar. Fill orders before they run out.

| Key | Action |
| --- | --- |
| `WASD` / arrows | Move your chef |
| `Space` | Use the station you're standing next to |
| `T` | Cycle the selected topping (at the prep station) |
| `Enter` | Serve the taco you're carrying |

**The loop:** grab a shell at **MASSA** → cook a patty at **GRELHA** (pick it up on
the green ring for a perfect "no ponto", not raw and not burnt) → add the requested
toppings at **MONTAGEM** → deliver at **SERVIR**. Perfect orders build a combo for
bonus points; messed-up tacos go in the **LIXO**.

## Tech

- **Vite + TypeScript**, no game framework — just Canvas 2D.
- **Fixed-timestep, deterministic simulation** (`src/game/sim.ts`) that takes an
  array of player inputs. That shape is deliberate: adding a second player (local
  or over WebRTC) means adding a second entry to the input array, not rewriting
  the game.
- Procedural food rendering (`src/render/food.ts`) and synthesized audio
  (`src/engine/audio.ts`).

## Project layout

```
src/
  engine/   loop.ts (fixed timestep) · input.ts · audio.ts (Web Audio synth)
  game/     state.ts · sim.ts (pure step) · recipes.ts (data + seeded RNG)
  render/   renderer.ts · food.ts · particles.ts
  main.ts   canvas + start screen + wiring
```
