/**
 * Recipe & ingredient definitions.
 *
 * Everything here is data: colors and shapes are described so the renderer
 * can draw food procedurally (no image assets). Adding a new topping is a
 * one-line change here plus a draw case in render/food.ts.
 */

export type Topping = "cheese" | "lettuce" | "salsa" | "guac" | "cream";

export const TOPPINGS: Topping[] = [
  "cheese",
  "lettuce",
  "salsa",
  "guac",
  "cream",
];

export const TOPPING_INFO: Record<
  Topping,
  { label: string; color: string; emoji: string }
> = {
  cheese: { label: "Queijo", color: "#f2c14e", emoji: "🧀" },
  lettuce: { label: "Alface", color: "#6dbe45", emoji: "🥬" },
  salsa: { label: "Salsa", color: "#d64545", emoji: "🍅" },
  guac: { label: "Guaca", color: "#7aa845", emoji: "🥑" },
  cream: { label: "Creme", color: "#f4f1e6", emoji: "🥛" },
};

/** Meat doneness state while / after grilling. */
export type Doneness = "raw" | "cooking" | "cooked" | "burnt";

/** Seconds of grill time. */
export const GRILL_RAW_TO_COOKED = 3.2;
/** How long the "perfect cooked" window lasts before it starts to burn. */
export const GRILL_COOKED_WINDOW = 2.2;

export function donenessFromTime(t: number): Doneness {
  if (t <= 0) return "raw";
  if (t < GRILL_RAW_TO_COOKED) return "cooking";
  if (t < GRILL_RAW_TO_COOKED + GRILL_COOKED_WINDOW) return "cooked";
  return "burnt";
}

/** A customer's requested taco. */
export interface Order {
  id: number;
  toppings: Topping[]; // required toppings (order-independent set)
  patience: number; // seconds remaining
  maxPatience: number;
}

/**
 * Deterministic RNG (mulberry32). Seeded so that, given the same seed and the
 * same call sequence, every peer generates identical customers — required for
 * the Phase 4 host-authoritative netcode.
 */
export function makeRng(seed: number) {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let orderCounter = 1;

export function makeOrder(rng: () => number, difficulty: number): Order {
  // 1..3 toppings, scaling slightly with difficulty.
  const count = 1 + Math.floor(rng() * Math.min(3, 1 + difficulty));
  const pool = [...TOPPINGS];
  const chosen: Topping[] = [];
  for (let i = 0; i < count && pool.length; i++) {
    const idx = Math.floor(rng() * pool.length);
    chosen.push(pool.splice(idx, 1)[0]);
  }
  const patience = Math.max(14, 30 - difficulty * 2);
  return {
    id: orderCounter++,
    toppings: chosen.sort(),
    patience,
    maxPatience: patience,
  };
}

/** Compare a served taco against an order. Returns 0..1 accuracy. */
export function scoreMatch(
  served: Topping[],
  meat: Doneness,
  order: Order,
): { accuracy: number; meatOk: boolean } {
  const want = new Set(order.toppings);
  const got = new Set(served);
  let correct = 0;
  for (const t of want) if (got.has(t)) correct++;
  let wrong = 0;
  for (const t of got) if (!want.has(t)) wrong++;
  const toppingScore =
    want.size === 0 ? 1 : Math.max(0, (correct - wrong) / want.size);
  const meatOk = meat === "cooked";
  return { accuracy: toppingScore, meatOk };
}
