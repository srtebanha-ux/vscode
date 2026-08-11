/**
 * Entry point: builds the canvas, shows a start screen (needed so the browser
 * lets us start audio), then runs the fixed-timestep loop.
 *
 * Structure note: the loop feeds an ARRAY of InputStates into `step`. Today
 * that array has one entry (local player). Phase 3 adds a second local input;
 * Phase 4 replaces entry [1] with inputs arriving over WebRTC — the sim never
 * needs to change.
 */

import { startLoop } from "./engine/loop.ts";
import { Keyboard } from "./engine/input.ts";
import { audio } from "./engine/audio.ts";
import { GameState, initialState, stationCenter, WORLD_H, WORLD_W } from "./game/state.ts";
import { step } from "./game/sim.ts";
import { render } from "./render/renderer.ts";
import { Particles } from "./render/particles.ts";

const app = document.getElementById("app")!;

const canvas = document.createElement("canvas");
canvas.width = WORLD_W;
canvas.height = WORLD_H;
canvas.style.aspectRatio = `${WORLD_W} / ${WORLD_H}`;
app.appendChild(canvas);
const ctx = canvas.getContext("2d")!;

// Keep the canvas fitting the viewport while preserving aspect ratio.
function fit() {
  const pad = 24;
  const scale = Math.min(
    (window.innerWidth - pad) / WORLD_W,
    (window.innerHeight - pad) / WORLD_H,
  );
  canvas.style.width = `${WORLD_W * scale}px`;
  canvas.style.height = `${WORLD_H * scale}px`;
}
window.addEventListener("resize", fit);
fit();

const keyboard = new Keyboard();
const particles = new Particles();
let state: GameState = initialState(Date.now() & 0xffffffff);
let started = false;
let prevScore = 0;
let smokeCooldown = 0;

function drawStartScreen() {
  render(ctx, state); // draw the kitchen behind the overlay
  ctx.fillStyle = "rgba(20,12,30,0.82)";
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffd166";
  ctx.font = "bold 64px 'Trebuchet MS', sans-serif";
  ctx.fillText("🌮 Taco Together", WORLD_W / 2, WORLD_H / 2 - 70);
  ctx.fillStyle = "#e8dff0";
  ctx.font = "20px 'Trebuchet MS', sans-serif";
  ctx.fillText(
    "Cozinha coop — monte tacos antes que os clientes desistam!",
    WORLD_W / 2,
    WORLD_H / 2 - 20,
  );
  ctx.font = "16px 'Trebuchet MS', sans-serif";
  ctx.fillStyle = "#c9b8dd";
  const lines = [
    "MASSA: pegue a base do taco   •   GRELHA: cozinhe a carne no ponto",
    "MONTAGEM: T troca o ingrediente, ESPAÇO adiciona   •   SERVIR: entregue o pedido",
  ];
  lines.forEach((l, i) =>
    ctx.fillText(l, WORLD_W / 2, WORLD_H / 2 + 30 + i * 26),
  );
  ctx.fillStyle = "#ff7a59";
  ctx.font = "bold 22px 'Trebuchet MS', sans-serif";
  const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 300);
  ctx.globalAlpha = pulse;
  ctx.fillText("Clique ou pressione ESPAÇO para começar", WORLD_W / 2, WORLD_H / 2 + 110);
  ctx.globalAlpha = 1;
}

function begin() {
  if (started) return;
  started = true;
  audio.resume();
  state = initialState(Date.now() & 0xffffffff);
  prevScore = 0;
}

canvas.addEventListener("pointerdown", begin);
window.addEventListener("keydown", (e) => {
  if (!started && (e.code === "Space" || e.code === "Enter")) begin();
});

startLoop({
  update: (dt) => {
    if (!started) return;
    const input = keyboard.snapshot();
    step(state, [input], dt);

    // Cosmetic particle triggers (render-only).
    if (state.score > prevScore) {
      const serve = state.stations.find((s) => s.kind === "serve")!;
      const { cx, cy } = stationCenter(serve);
      particles.confetti(cx, cy);
    }
    prevScore = state.score;

    smokeCooldown -= dt;
    if (state.grill.occupied && smokeCooldown <= 0) {
      const grill = state.stations.find((s) => s.kind === "grill")!;
      const { cx, cy } = stationCenter(grill);
      particles.smoke(cx, cy - 6);
      smokeCooldown = 0.12;
    }
    particles.update(dt);
  },
  render: () => {
    ctx.clearRect(0, 0, WORLD_W, WORLD_H);
    if (!started) {
      drawStartScreen();
      return;
    }
    render(ctx, state);
    particles.draw(ctx);
  },
});
