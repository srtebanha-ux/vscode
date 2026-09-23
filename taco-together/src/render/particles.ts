/**
 * Render-only particle system (juice: smoke, confetti, sparkles).
 *
 * Particles are intentionally NOT part of the simulation state — they are
 * cosmetic and don't need to be deterministic or networked. main.ts spawns
 * them in response to game events.
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  gravity: number;
}

export class Particles {
  private items: Particle[] = [];

  confetti(x: number, y: number, count = 24): void {
    const colors = ["#ff7a59", "#f2c14e", "#6dbe45", "#4ea8de", "#d64545"];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 180;
      this.items.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 120,
        life: 0.9 + Math.random() * 0.6,
        maxLife: 1.5,
        color: colors[(Math.random() * colors.length) | 0],
        size: 3 + Math.random() * 3,
        gravity: 320,
      });
    }
  }

  smoke(x: number, y: number): void {
    this.items.push({
      x: x + (Math.random() - 0.5) * 12,
      y,
      vx: (Math.random() - 0.5) * 12,
      vy: -30 - Math.random() * 20,
      life: 0.8,
      maxLife: 0.8,
      color: "rgba(200,200,200,0.5)",
      size: 6 + Math.random() * 6,
      gravity: -10,
    });
  }

  update(dt: number): void {
    for (const p of this.items) {
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.items = this.items.filter((p) => p.life > 0);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.items) {
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
