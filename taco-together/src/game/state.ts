/**
 * Game state & world layout.
 *
 * GameState is a plain, serializable object (no methods, no class instances)
 * on purpose: the whole thing can be JSON-copied and sent over the network,
 * and the simulation (sim.ts) is a pure function of (state, inputs, dt).
 */

import { Doneness, Order, Topping } from "./recipes.ts";

export const WORLD_W = 960;
export const WORLD_H = 600;

export type StationKind =
  | "ingredients"
  | "grill"
  | "prep"
  | "serve"
  | "trash";

export interface Station {
  kind: StationKind;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

/** What a player is carrying. `null` = empty hands. */
export interface Plate {
  hasMeat: boolean;
  meat: Doneness;
  meatGrillTime: number; // captured doneness time when picked up
  toppings: Topping[];
}

export interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number; // radians, for the little chef nose
  carrying: Plate | null;
  color: string;
  selectedTopping: number; // index into TOPPINGS
  bob: number; // walk-cycle phase
}

/** A patty currently on the grill (independent of any player). */
export interface GrillSlot {
  occupied: boolean;
  time: number; // seconds on grill
  doneness: Doneness;
}

export interface GameState {
  players: Player[];
  stations: Station[];
  grill: GrillSlot;
  orders: Order[];
  score: number;
  combo: number;
  spawnTimer: number;
  difficulty: number;
  elapsed: number;
  rngState: number;
  toast: { text: string; color: string; t: number } | null;
}

export const STATIONS: Station[] = [
  { kind: "ingredients", x: 60, y: 120, w: 120, h: 120, label: "MASSA" },
  { kind: "grill", x: 60, y: 340, w: 140, h: 140, label: "GRELHA" },
  { kind: "prep", x: 410, y: 430, w: 160, h: 120, label: "MONTAGEM" },
  { kind: "serve", x: 780, y: 120, w: 120, h: 300, label: "SERVIR" },
  { kind: "trash", x: 800, y: 470, w: 90, h: 90, label: "LIXO" },
];

export function makePlayer(x: number, y: number, color: string): Player {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    facing: 0,
    carrying: null,
    color,
    selectedTopping: 0,
    bob: 0,
  };
}

export function initialState(seed = 12345): GameState {
  return {
    players: [makePlayer(300, 300, "#ff7a59")],
    stations: STATIONS,
    grill: { occupied: false, time: 0, doneness: "raw" },
    orders: [],
    score: 0,
    combo: 0,
    spawnTimer: 2,
    difficulty: 1,
    elapsed: 0,
    rngState: seed,
    toast: null,
  };
}

/** Center point of a station (for proximity checks and drawing). */
export function stationCenter(s: Station): { cx: number; cy: number } {
  return { cx: s.x + s.w / 2, cy: s.y + s.h / 2 };
}

/** Nearest station within `radius` of a point, or null. */
export function nearestStation(
  state: GameState,
  x: number,
  y: number,
  radius = 70,
): Station | null {
  let best: Station | null = null;
  let bestD = radius * radius;
  for (const s of state.stations) {
    const { cx, cy } = stationCenter(s);
    const d = (cx - x) ** 2 + (cy - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}
