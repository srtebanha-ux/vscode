/**
 * Procedural food drawing. Every edible thing in the game is a few canvas
 * paths — no sprite sheets. A taco is an arc (the shell) filled with colored
 * shapes for meat and toppings.
 */

import { Doneness, Topping, TOPPING_INFO } from "../game/recipes.ts";
import { Plate } from "../game/state.ts";

const MEAT_COLOR: Record<Doneness, string> = {
  raw: "#e79a9a",
  cooking: "#c96f4a",
  cooked: "#8a4b2a",
  burnt: "#2b1a12",
};

/** Draw a taco (optionally with contents) centered at (x, y), scale s. */
export function drawTaco(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  plate: Plate | null,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);

  // Shell — a folded tortilla (U shape).
  ctx.beginPath();
  ctx.moveTo(-22, -14);
  ctx.quadraticCurveTo(-26, 20, 0, 22);
  ctx.quadraticCurveTo(26, 20, 22, -14);
  ctx.closePath();
  const shellGrad = ctx.createLinearGradient(0, -14, 0, 22);
  shellGrad.addColorStop(0, "#f6d488");
  shellGrad.addColorStop(1, "#e0a94e");
  ctx.fillStyle = shellGrad;
  ctx.fill();
  ctx.strokeStyle = "#b9822f";
  ctx.lineWidth = 2;
  ctx.stroke();

  if (plate) {
    // Meat layer.
    if (plate.hasMeat) {
      ctx.fillStyle = MEAT_COLOR[plate.meat];
      roundRect(ctx, -16, 2, 32, 12, 5);
      ctx.fill();
    }
    // Toppings stacked as little colored blobs.
    let ty = plate.hasMeat ? -2 : 6;
    for (const t of plate.toppings) {
      drawTopping(ctx, t, ty);
      ty -= 6;
    }
  }

  // Front rim of the shell (drawn last so filling tucks behind).
  ctx.beginPath();
  ctx.moveTo(-22, -14);
  ctx.quadraticCurveTo(0, -4, 22, -14);
  ctx.strokeStyle = "#f6d488";
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.restore();
}

function drawTopping(
  ctx: CanvasRenderingContext2D,
  t: Topping,
  y: number,
): void {
  ctx.fillStyle = TOPPING_INFO[t].color;
  if (t === "lettuce" || t === "guac") {
    // ruffled band
    ctx.beginPath();
    for (let x = -16; x <= 16; x += 4) {
      ctx.lineTo(x, y + (x % 8 === 0 ? -2 : 2));
    }
    ctx.lineWidth = 4;
    ctx.strokeStyle = TOPPING_INFO[t].color;
    ctx.stroke();
  } else if (t === "cheese") {
    for (let x = -14; x <= 14; x += 7) {
      ctx.beginPath();
      ctx.moveTo(x, y - 3);
      ctx.lineTo(x + 4, y + 3);
      ctx.lineTo(x - 4, y + 3);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    // salsa / cream: small dots
    for (let x = -14; x <= 14; x += 6) {
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
