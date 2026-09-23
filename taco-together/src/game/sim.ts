/**
 * The simulation: a (mostly) pure function of (state, inputs, dt).
 *
 * It mutates the passed-in state for performance, but never touches the DOM,
 * the renderer, or global time — everything it needs is an argument. That is
 * what lets us later run it host-authoritatively and feed a remote player's
 * inputs in unchanged.
 */

import { InputState } from "../engine/input.ts";
import { audio } from "../engine/audio.ts";
import {
  Doneness,
  donenessFromTime,
  makeOrder,
  makeRng,
  scoreMatch,
  TOPPINGS,
  TOPPING_INFO,
} from "./recipes.ts";
import {
  GameState,
  nearestStation,
  Plate,
  Player,
  Station,
  WORLD_H,
  WORLD_W,
} from "./state.ts";

const PLAYER_SPEED = 260; // px/s
const PLAYER_RADIUS = 20;

function emptyPlate(): Plate {
  return { hasMeat: false, meat: "raw", meatGrillTime: 0, toppings: [] };
}

function toast(state: GameState, text: string, color: string) {
  state.toast = { text, color, t: 1.4 };
}

export function step(state: GameState, inputs: InputState[], dt: number): void {
  state.elapsed += dt;

  // --- Order spawning & patience -----------------------------------------
  const rng = makeRng(state.rngState);
  state.spawnTimer -= dt;
  const maxOrders = 4;
  if (state.spawnTimer <= 0 && state.orders.length < maxOrders) {
    state.orders.push(makeOrder(rng, state.difficulty));
    // advance stored rng state so the next spawn differs deterministically
    state.rngState = Math.floor(rng() * 0xffffffff) >>> 0;
    state.spawnTimer = Math.max(3.5, 8 - state.difficulty * 0.4);
  }
  for (const order of state.orders) order.patience -= dt;
  const expired = state.orders.filter((o) => o.patience <= 0);
  if (expired.length) {
    state.orders = state.orders.filter((o) => o.patience > 0);
    state.score = Math.max(0, state.score - 5 * expired.length);
    state.combo = 0;
    audio.buzz();
    toast(state, "Cliente foi embora! 😤", "#d64545");
  }

  // Difficulty creeps up over time.
  state.difficulty = 1 + Math.floor(state.elapsed / 30);

  // --- Grill cooking (independent of players) ----------------------------
  if (state.grill.occupied) {
    state.grill.time += dt;
    const prev = state.grill.doneness;
    state.grill.doneness = donenessFromTime(state.grill.time);
    if (prev !== "burnt" && state.grill.doneness === "burnt") {
      audio.buzz();
      toast(state, "Carne queimou! 🔥", "#d64545");
    }
  }

  // --- Players -----------------------------------------------------------
  for (let i = 0; i < state.players.length; i++) {
    updatePlayer(state, state.players[i], inputs[i] ?? noInput(), dt);
  }

  // --- Toast fade --------------------------------------------------------
  if (state.toast) {
    state.toast.t -= dt;
    if (state.toast.t <= 0) state.toast = null;
  }
}

function noInput(): InputState {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
    actionPressed: false,
    grillPressed: false,
    servePressed: false,
    cyclePressed: false,
  };
}

function updatePlayer(
  state: GameState,
  p: Player,
  input: InputState,
  dt: number,
): void {
  // Movement
  let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy);
    dx /= len;
    dy /= len;
    p.facing = Math.atan2(dy, dx);
    p.bob += dt * 12;
  }
  p.vx = dx * PLAYER_SPEED;
  p.vy = dy * PLAYER_SPEED;
  p.x = clamp(p.x + p.vx * dt, PLAYER_RADIUS, WORLD_W - PLAYER_RADIUS);
  p.y = clamp(p.y + p.vy * dt, PLAYER_RADIUS + 40, WORLD_H - PLAYER_RADIUS);

  const near = nearestStation(state, p.x, p.y);

  // Cycle selected topping (for the prep station).
  if (input.cyclePressed) {
    p.selectedTopping = (p.selectedTopping + 1) % TOPPINGS.length;
    audio.pop();
  }

  // Primary action (Space) — context-sensitive on the nearby station.
  if (input.actionPressed && near) {
    handleAction(state, p, near);
  }

  // Serve (Enter) works from the serve window.
  if (input.servePressed && near && near.kind === "serve") {
    handleServe(state, p);
  }
}

function handleAction(state: GameState, p: Player, station: Station): void {
  switch (station.kind) {
    case "ingredients": {
      // Grab a fresh empty taco shell if hands are free.
      if (!p.carrying) {
        p.carrying = emptyPlate();
        audio.pop();
      } else {
        toast(state, "Mãos ocupadas!", "#f2c14e");
      }
      break;
    }
    case "grill": {
      handleGrill(state, p);
      break;
    }
    case "prep": {
      // Add the currently selected topping to the carried taco.
      if (!p.carrying) {
        toast(state, "Pegue uma massa primeiro", "#f2c14e");
        break;
      }
      const t = TOPPINGS[p.selectedTopping];
      if (p.carrying.toppings.includes(t)) {
        toast(state, `${TOPPING_INFO[t].label} já está no taco`, "#f2c14e");
      } else {
        p.carrying.toppings.push(t);
        p.carrying.toppings.sort();
        audio.pop();
      }
      break;
    }
    case "trash": {
      if (p.carrying) {
        p.carrying = null;
        audio.buzz();
        toast(state, "Taco descartado", "#8a7a99");
      }
      break;
    }
    case "serve":
      handleServe(state, p);
      break;
  }
}

function handleGrill(state: GameState, p: Player): void {
  const grill = state.grill;
  if (!grill.occupied) {
    // Put raw meat on the grill. Requires a plate (represents having a patty).
    if (!p.carrying) {
      toast(state, "Pegue uma massa primeiro", "#f2c14e");
      return;
    }
    if (p.carrying.hasMeat) {
      toast(state, "Este taco já tem carne", "#f2c14e");
      return;
    }
    grill.occupied = true;
    grill.time = 0;
    grill.doneness = "raw";
    audio.sizzle();
    toast(state, "Carne na grelha… 🔥", "#ff7a59");
  } else {
    // Pick the patty up onto the carried plate.
    if (!p.carrying) {
      toast(state, "Pegue uma massa para a carne", "#f2c14e");
      return;
    }
    if (p.carrying.hasMeat) {
      toast(state, "Você já tem carne", "#f2c14e");
      return;
    }
    const done: Doneness = grill.doneness;
    p.carrying.hasMeat = true;
    p.carrying.meat = done === "cooking" ? "cooking" : done;
    p.carrying.meatGrillTime = grill.time;
    grill.occupied = false;
    grill.time = 0;
    grill.doneness = "raw";
    if (done === "cooked") {
      audio.perfect();
      toast(state, "Ponto perfeito! 👌", "#6dbe45");
    } else if (done === "burnt") {
      audio.buzz();
      toast(state, "Carne queimada 😬", "#d64545");
    } else {
      toast(state, "Carne crua… cozinhe mais", "#f2c14e");
    }
  }
}

function handleServe(state: GameState, p: Player): void {
  if (!p.carrying) {
    toast(state, "Nada para servir", "#f2c14e");
    return;
  }
  const plate = p.carrying;
  if (!plate.hasMeat) {
    toast(state, "Falta a carne!", "#d64545");
    return;
  }
  // Match against the best-fitting order (front of queue that it satisfies).
  let bestIdx = -1;
  let bestScore = -1;
  for (let i = 0; i < state.orders.length; i++) {
    const { accuracy } = scoreMatch(plate.toppings, plate.meat, state.orders[i]);
    if (accuracy > bestScore) {
      bestScore = accuracy;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) {
    toast(state, "Nenhum pedido na fila", "#f2c14e");
    return;
  }
  const order = state.orders[bestIdx];
  const { accuracy, meatOk } = scoreMatch(plate.toppings, plate.meat, order);

  if (accuracy >= 0.99 && meatOk) {
    state.combo += 1;
    const speedBonus = Math.round((order.patience / order.maxPatience) * 5);
    const gained = 10 + speedBonus + state.combo * 2;
    state.score += gained;
    audio.ding();
    toast(state, `Perfeito! +${gained} (combo x${state.combo})`, "#6dbe45");
    state.orders.splice(bestIdx, 1);
    p.carrying = null;
  } else if (accuracy >= 0.5 && meatOk) {
    const gained = 4;
    state.score += gained;
    state.combo = 0;
    audio.ding();
    toast(state, `Quase! +${gained}`, "#f2c14e");
    state.orders.splice(bestIdx, 1);
    p.carrying = null;
  } else {
    state.score = Math.max(0, state.score - 3);
    state.combo = 0;
    audio.buzz();
    const reason = !meatOk ? "carne no ponto errado" : "ingredientes errados";
    toast(state, `Errado (${reason}) -3`, "#d64545");
    p.carrying = null;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
