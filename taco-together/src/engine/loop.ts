/**
 * Fixed-timestep game loop.
 *
 * The simulation advances in deterministic fixed steps (SIM_HZ), while
 * rendering happens as fast as the browser allows with an interpolation
 * alpha. Determinism here is what makes the netcode (Phase 4+) tractable:
 * given the same starting state and the same input stream, every peer
 * computes the same result.
 */

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ; // seconds per simulation step

export interface LoopCallbacks {
  /** Advance the simulation by exactly SIM_DT seconds. */
  update: (dt: number) => void;
  /** Draw the current state. `alpha` is the 0..1 blend toward the next step. */
  render: (alpha: number) => void;
}

export function startLoop({ update, render }: LoopCallbacks): () => void {
  let last = performance.now();
  let accumulator = 0;
  let running = true;
  // Guard against the "spiral of death" after a tab is backgrounded.
  const MAX_FRAME = 0.25;

  function frame(now: number) {
    if (!running) return;
    let elapsed = (now - last) / 1000;
    last = now;
    if (elapsed > MAX_FRAME) elapsed = MAX_FRAME;

    accumulator += elapsed;
    while (accumulator >= SIM_DT) {
      update(SIM_DT);
      accumulator -= SIM_DT;
    }

    render(accumulator / SIM_DT);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
  return () => {
    running = false;
  };
}
