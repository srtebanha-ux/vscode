/**
 * Renderer — draws the whole game from GameState using only canvas paths.
 * Pure output: it reads state and draws, never mutates game logic.
 */

import {
  Doneness,
  Order,
  TOPPINGS,
  TOPPING_INFO,
} from "../game/recipes.ts";
import {
  GameState,
  Player,
  Station,
  stationCenter,
  WORLD_H,
  WORLD_W,
  nearestStation,
} from "../game/state.ts";
import { drawTaco, roundRect } from "./food.ts";

const STATION_STYLE: Record<
  Station["kind"],
  { fill: string; top: string; icon: string }
> = {
  ingredients: { fill: "#4a3b5c", top: "#6a5480", icon: "🌮" },
  grill: { fill: "#3a2a2a", top: "#5a3a3a", icon: "🔥" },
  prep: { fill: "#3b4a5c", top: "#54708a", icon: "🔪" },
  serve: { fill: "#2f4a3a", top: "#3f6a52", icon: "🛎️" },
  trash: { fill: "#33333a", top: "#4a4a55", icon: "🗑️" },
};

const MEAT_COLOR: Record<Doneness, string> = {
  raw: "#e79a9a",
  cooking: "#c96f4a",
  cooked: "#8a4b2a",
  burnt: "#2b1a12",
};

export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
): void {
  drawFloor(ctx);

  for (const s of state.stations) drawStation(ctx, s, state);
  drawGrillContents(ctx, state);

  // Order tickets across the top.
  drawOrders(ctx, state);

  // Players (sorted by y for a little depth).
  const players = [...state.players].sort((a, b) => a.y - b.y);
  for (const p of players) drawPlayer(ctx, p, state);

  drawHud(ctx, state);
  drawToast(ctx, state);
  drawControls(ctx);
}

function drawFloor(ctx: CanvasRenderingContext2D): void {
  const tile = 48;
  for (let y = 40; y < WORLD_H; y += tile) {
    for (let x = 0; x < WORLD_W; x += tile) {
      const even = ((x / tile) | 0) % 2 === ((y / tile) | 0) % 2;
      ctx.fillStyle = even ? "#332444" : "#2c1f3b";
      ctx.fillRect(x, y, tile, tile);
    }
  }
  // Top order rail.
  ctx.fillStyle = "#20162e";
  ctx.fillRect(0, 0, WORLD_W, 40);
}

function drawStation(
  ctx: CanvasRenderingContext2D,
  s: Station,
  state: GameState,
): void {
  const style = STATION_STYLE[s.kind];
  // Highlight if a player is close enough to interact.
  const isNear = state.players.some(
    (p) => nearestStation(state, p.x, p.y) === s,
  );

  // Counter base (with a subtle drop shadow).
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  roundRect(ctx, s.x + 4, s.y + 6, s.w, s.h, 10);
  ctx.fill();

  ctx.fillStyle = style.fill;
  roundRect(ctx, s.x, s.y, s.w, s.h, 10);
  ctx.fill();
  ctx.fillStyle = style.top;
  roundRect(ctx, s.x, s.y, s.w, 22, 10);
  ctx.fill();

  if (isNear) {
    ctx.strokeStyle = "#ffd166";
    ctx.lineWidth = 3;
    roundRect(ctx, s.x, s.y, s.w, s.h, 10);
    ctx.stroke();
  }

  // Icon + label
  const { cx } = stationCenter(s);
  ctx.font = "28px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(style.icon, cx, s.y + s.h / 2 - 6);
  ctx.font = "bold 13px 'Trebuchet MS', sans-serif";
  ctx.fillStyle = "#e8dff0";
  ctx.fillText(s.label, cx, s.y + s.h - 14);

  // Prep station shows the currently-selected topping palette.
  if (s.kind === "prep") drawPrepPalette(ctx, s, state);
}

function drawPrepPalette(
  ctx: CanvasRenderingContext2D,
  s: Station,
  state: GameState,
): void {
  const sel = state.players[0]?.selectedTopping ?? 0;
  const startX = s.x + 16;
  const y = s.y - 30;
  ctx.font = "18px system-ui";
  for (let i = 0; i < TOPPINGS.length; i++) {
    const t = TOPPINGS[i];
    const x = startX + i * 28;
    if (i === sel) {
      ctx.fillStyle = "#ffd166";
      roundRect(ctx, x - 11, y - 13, 26, 26, 6);
      ctx.fill();
    }
    ctx.fillStyle = TOPPING_INFO[t].color;
    ctx.beginPath();
    ctx.arc(x + 2, y, 9, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGrillContents(
  ctx: CanvasRenderingContext2D,
  state: GameState,
): void {
  const grill = state.stations.find((s) => s.kind === "grill");
  if (!grill) return;
  const { cx, cy } = stationCenter(grill);

  // Grill grate lines.
  ctx.strokeStyle = "#1a1010";
  ctx.lineWidth = 2;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(cx - 40, cy + i * 10);
    ctx.lineTo(cx + 40, cy + i * 10);
    ctx.stroke();
  }

  if (state.grill.occupied) {
    // The patty, colored by doneness.
    ctx.fillStyle = MEAT_COLOR[state.grill.doneness];
    roundRect(ctx, cx - 22, cy - 9, 44, 18, 8);
    ctx.fill();

    // Doneness progress ring.
    const total = 5.4; // raw->cooked->burnt span used for the ring
    const frac = Math.min(1, state.grill.time / total);
    ctx.beginPath();
    ctx.arc(cx, cy, 34, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.strokeStyle =
      state.grill.doneness === "cooked"
        ? "#6dbe45"
        : state.grill.doneness === "burnt"
          ? "#d64545"
          : "#f2c14e";
    ctx.lineWidth = 4;
    ctx.stroke();
  }
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  p: Player,
  _state: GameState,
): void {
  const bobY = Math.sin(p.bob) * 2;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + 20, 16, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body
  ctx.fillStyle = p.color;
  roundRect(ctx, p.x - 14, p.y - 8 + bobY, 28, 28, 10);
  ctx.fill();

  // Head
  ctx.fillStyle = "#ffe0bd";
  ctx.beginPath();
  ctx.arc(p.x, p.y - 16 + bobY, 12, 0, Math.PI * 2);
  ctx.fill();

  // Chef hat
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, p.x - 11, p.y - 34 + bobY, 22, 12, 6);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(p.x - 7, p.y - 32 + bobY, 6, 0, Math.PI * 2);
  ctx.arc(p.x + 7, p.y - 32 + bobY, 6, 0, Math.PI * 2);
  ctx.arc(p.x, p.y - 36 + bobY, 7, 0, Math.PI * 2);
  ctx.fill();

  // Facing nose
  ctx.fillStyle = "#e0a87f";
  ctx.beginPath();
  ctx.arc(
    p.x + Math.cos(p.facing) * 9,
    p.y - 16 + bobY + Math.sin(p.facing) * 5,
    3,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Carried taco floating above the hat.
  if (p.carrying) {
    drawTaco(ctx, p.x, p.y - 52 + bobY, 0.7, p.carrying);
  }
}

function drawOrders(ctx: CanvasRenderingContext2D, state: GameState): void {
  const startX = 220;
  const y = 52;
  ctx.textAlign = "center";
  for (let i = 0; i < state.orders.length; i++) {
    const o = state.orders[i];
    const x = startX + i * 130;
    drawTicket(ctx, o, x, y);
  }
}

function drawTicket(
  ctx: CanvasRenderingContext2D,
  o: Order,
  x: number,
  y: number,
): void {
  const w = 116;
  const h = 96;
  // Paper
  ctx.fillStyle = "#f7f0df";
  roundRect(ctx, x - w / 2, y, w, h, 8);
  ctx.fill();
  ctx.strokeStyle = "#d8cba5";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Header
  ctx.fillStyle = "#8a4b2a";
  ctx.font = "bold 12px 'Trebuchet MS', sans-serif";
  ctx.fillText("PEDIDO", x, y + 14);

  // Required toppings as chips.
  ctx.font = "11px system-ui";
  let ly = y + 30;
  ctx.fillStyle = "#3a2a1a";
  ctx.fillText("🥩 carne no ponto", x, ly);
  ly += 16;
  for (const t of o.toppings) {
    ctx.fillStyle = TOPPING_INFO[t].color;
    ctx.beginPath();
    ctx.arc(x - 34, ly - 3, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#3a2a1a";
    ctx.textAlign = "left";
    ctx.fillText(TOPPING_INFO[t].label, x - 24, ly);
    ctx.textAlign = "center";
    ly += 15;
  }

  // Patience bar.
  const frac = Math.max(0, o.patience / o.maxPatience);
  const barY = y + h - 10;
  ctx.fillStyle = "#e0d6bf";
  roundRect(ctx, x - w / 2 + 8, barY, w - 16, 6, 3);
  ctx.fill();
  ctx.fillStyle = frac > 0.5 ? "#6dbe45" : frac > 0.25 ? "#f2c14e" : "#d64545";
  roundRect(ctx, x - w / 2 + 8, barY, (w - 16) * frac, 6, 3);
  ctx.fill();
}

function drawHud(ctx: CanvasRenderingContext2D, state: GameState): void {
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = "bold 20px 'Trebuchet MS', sans-serif";
  ctx.fillStyle = "#ffd166";
  ctx.fillText(`🌮 ${state.score}`, 16, 20);

  ctx.font = "13px 'Trebuchet MS', sans-serif";
  ctx.fillStyle = "#c9b8dd";
  ctx.fillText(`Nível ${state.difficulty}`, 110, 20);
  if (state.combo > 1) {
    ctx.fillStyle = "#ff7a59";
    ctx.fillText(`Combo x${state.combo}`, 180, 20);
  }
}

function drawToast(ctx: CanvasRenderingContext2D, state: GameState): void {
  if (!state.toast) return;
  const alpha = Math.min(1, state.toast.t / 0.5);
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.font = "bold 22px 'Trebuchet MS', sans-serif";
  const x = WORLD_W / 2;
  const y = WORLD_H - 130;
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  const tw = ctx.measureText(state.toast.text).width + 32;
  roundRect(ctx, x - tw / 2, y - 22, tw, 40, 10);
  ctx.fill();
  ctx.fillStyle = state.toast.color;
  ctx.fillText(state.toast.text, x, y);
  ctx.globalAlpha = 1;
}

function drawControls(ctx: CanvasRenderingContext2D): void {
  ctx.textAlign = "center";
  ctx.font = "12px 'Trebuchet MS', sans-serif";
  ctx.fillStyle = "#7a6a8f";
  ctx.fillText(
    "WASD/setas: mover  •  ESPAÇO: usar estação  •  T: trocar ingrediente  •  ENTER: servir",
    WORLD_W / 2,
    WORLD_H - 12,
  );
}
