# 🌮 Taco Together — Game Design & Technical Plan

A cooperative taco-cooking game (Papa's Taco Mia / Overcooked flavor), designed
to be buildable **100% inside Claude Code**. The guiding constraint drives every
decision: keep the entire game as **text** so an AI agent can author all of it.

- **Graphics:** Canvas 2D, drawn procedurally (shapes, gradients, particles). No sprite sheets.
- **Audio:** Web Audio API synthesis. No `.mp3`/`.wav` files.
- **Co-op:** online **P2P via WebRTC**, with local co-op as the stepping stone.

---

## 1. Gameplay

You run a taco stand. Customers arrive with an order — a cooked patty plus a set
of toppings — and a patience timer. The kitchen has stations; you walk between
them and press one context-sensitive button to interact.

**The order pipeline**

```
Customer appears (order + patience)
  → MASSA:     grab an empty taco shell
  → GRELHA:    cook a patty; pick it up in the "cooked" window (not raw, not burnt)
  → MONTAGEM:  add the requested toppings
  → SERVIR:    deliver; scored on accuracy + speed → points, combo
```

**Why it's a good co-op game:** the stations are physically separated, so under
load the fun comes from splitting work and handing off — one player grills while
the other assembles the next order. This is the Overcooked "communication under
pressure" loop, and it maps cleanly onto shared-simulation netcode.

**Scoring**
- Perfect order (all toppings correct, meat cooked): `10 + speedBonus + combo·2`, combo increments.
- Partial (≥50% toppings, meat cooked): small points, combo resets.
- Wrong / burnt / raw: small penalty, combo resets.
- Customer times out: penalty, combo resets.

---

## 2. Architecture

```
Browser client (Canvas + TS)
  Game loop (fixed dt) ──► Simulation (deterministic)  ──► Renderer (Canvas paths)
        ▲                        │                            
        │                        ▼                            
     Input  ────────────►  step(state, inputs[], dt)  ◄──── Netcode (WebRTC DataChannel)
                                                              Audio (Web Audio synth)
```

**Key idea — inputs as an array.** The simulation is `step(state, inputs[], dt)`.
Today `inputs` has one entry (the local player). Local co-op adds a second entry
from a second key map. Online co-op replaces that second entry with inputs
arriving over the network. **The game logic never changes** across these phases —
that's the whole point of the abstraction.

**Determinism.** Fixed 60 Hz timestep + a seeded RNG (`mulberry32`) for customer
generation means the same seed + same input stream produces the same game on
every machine. That's the foundation the netcode stands on.

---

## 3. Netcode plan (Phase 4+)

- **Transport:** WebRTC `RTCDataChannel` (unreliable/unordered for inputs — UDP-like).
- **Model:** **host-authoritative**. One peer runs the authoritative sim; the other
  sends inputs and renders the state it receives. Simpler and more robust than
  lockstep for a 2-player game, and hides jitter well for this pace of action.
- **Signaling** (the initial SDP/ICE handshake WebRTC needs):
  1. **Phase 4 — copy/paste, zero backend:** host generates an offer code, players
     paste codes to each other (via chat/WhatsApp). Ugly but needs no server.
  2. **Phase 5 — tiny signaling server:** ~50 lines of Node + `ws` giving "room codes".
- **NAT traversal:** a public STUN server covers most networks. Restrictive NATs
  need a **TURN** relay — documented as a known requirement, added if needed.

---

## 4. Art & audio without assets

- **Food:** each ingredient is a canvas-path function. Shell = filled arc; patty =
  rounded rect whose gradient shifts pink→brown→black with doneness; toppings =
  colored blobs/triangles/dots. (`src/render/food.ts`)
- **Characters:** body + head + chef hat, animated by code (walk bob, facing nose).
- **Audio:** oscillators + envelopes for pops/dings/buzzes; filtered white noise
  for the grill sizzle. (`src/engine/audio.ts`)
- **Juice:** render-only particle system for grill smoke and serve confetti —
  intentionally *not* part of the sim (cosmetic, doesn't need to be networked).

---

## 5. Roadmap

| Phase | Deliverable | Testable outcome |
| --- | --- | --- |
| **0** | Vite + TS setup, fixed-timestep loop, canvas | ✅ stable 60 fps |
| **1** | Single-player: MASSA → GRELHA → MONTAGEM → SERVIR, orders, patience, scoring, audio, particles | ✅ **done — playable now** |
| **2** | More recipes, meat types, level pacing, game-over/round timer, high score | Single-player is a full game |
| **3** | 2nd **local** player (second key map / gamepad), item hand-off | Couch co-op on one screen |
| **4** | WebRTC P2P + copy/paste signaling, host-authoritative sync | Online co-op between two tabs/machines |
| **5** | Signaling server (room codes), optional TURN | "Real" online co-op |
| **6** | Polish: difficulty curve, music loop (synth), menus, mobile touch controls | Shippable indie game |

**Sequencing rationale:** build **local** co-op (Phase 3) before touching the
network (Phase 4). Because the sim already consumes an input array, swapping
"local input #2" for "networked input #2" is nearly mechanical — this isolates
gameplay risk from netcode risk.

---

## 6. Locked technical decisions

- **Vite + TypeScript.** Fast dev server; static types are a big help for netcode.
- **Canvas 2D, no engine.** This game needs no physics/tilemaps; a framework would
  add weight and assets. (Phaser stays an option if scope grows.)
- **Fixed timestep + seeded RNG.** Determinism is non-negotiable for sync.
- **Host-authoritative, not lockstep.** Right complexity/robustness trade-off for 2P.

---

## 7. Current status (this branch)

Phase 0 and Phase 1 are implemented and verified (typechecks, builds, and runs
headless with no runtime errors). Next up: **Phase 2** polish, then **Phase 3**
local co-op as the on-ramp to WebRTC.
