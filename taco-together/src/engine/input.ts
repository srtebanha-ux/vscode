/**
 * Input abstraction.
 *
 * The rest of the game never reads the keyboard directly — it reads an
 * `InputState`. This indirection is deliberate: in Phase 4 (netcode) the
 * remote player's InputState will arrive over the WebRTC data channel and
 * be fed into the exact same simulation, with no changes to game logic.
 */

export interface InputState {
  /** Held this frame. */
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  /** Edge-triggered: true only on the frame the key went down. */
  actionPressed: boolean;
  grillPressed: boolean;
  servePressed: boolean;
  cyclePressed: boolean;
}

export function emptyInput(): InputState {
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

type KeyMap = {
  left: string[];
  right: string[];
  up: string[];
  down: string[];
  action: string[];
  grill: string[];
  serve: string[];
  cycle: string[];
};

const PLAYER1_KEYS: KeyMap = {
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  up: ["KeyW", "ArrowUp"],
  down: ["KeyS", "ArrowDown"],
  action: ["Space"],
  grill: ["KeyG"],
  serve: ["Enter"],
  cycle: ["KeyT"],
};

/**
 * Tracks raw key state and produces a per-frame InputState with correct
 * edge detection. Call `snapshot()` once per simulation step.
 */
export class Keyboard {
  private held = new Set<string>();
  private pressedSinceSnapshot = new Set<string>();

  constructor(private keys: KeyMap = PLAYER1_KEYS) {
    window.addEventListener("keydown", (e) => {
      if (this.isBound(e.code)) e.preventDefault();
      if (!this.held.has(e.code)) this.pressedSinceSnapshot.add(e.code);
      this.held.add(e.code);
    });
    window.addEventListener("keyup", (e) => {
      this.held.delete(e.code);
    });
    // Lose focus -> release everything so the player doesn't "stick".
    window.addEventListener("blur", () => {
      this.held.clear();
      this.pressedSinceSnapshot.clear();
    });
  }

  private isBound(code: string): boolean {
    return Object.values(this.keys).some((codes) => codes.includes(code));
  }

  private anyHeld(codes: string[]): boolean {
    return codes.some((c) => this.held.has(c));
  }

  private anyPressed(codes: string[]): boolean {
    return codes.some((c) => this.pressedSinceSnapshot.has(c));
  }

  snapshot(): InputState {
    const state: InputState = {
      left: this.anyHeld(this.keys.left),
      right: this.anyHeld(this.keys.right),
      up: this.anyHeld(this.keys.up),
      down: this.anyHeld(this.keys.down),
      actionPressed: this.anyPressed(this.keys.action),
      grillPressed: this.anyPressed(this.keys.grill),
      servePressed: this.anyPressed(this.keys.serve),
      cyclePressed: this.anyPressed(this.keys.cycle),
    };
    this.pressedSinceSnapshot.clear();
    return state;
  }
}
