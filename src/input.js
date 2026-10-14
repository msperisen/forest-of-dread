const BLOCK = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

// Keyboard + gamepad. `pressed` holds codes that went down this frame.
export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.gp = { x: 0, y: 0, fire: false };
    this.gpPrev = { fire: false, start: false };
    this.touch = { x: 0, y: 0, fire: false }; // written by touch.js
    addEventListener('keydown', (e) => {
      if (BLOCK.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('pointerdown', () => this.pressed.add('Pointer'));
  }

  poll() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()] : [];
    const gp = pads.find(Boolean);
    if (!gp) {
      this.gp = { x: 0, y: 0, fire: false };
      return;
    }
    const b = (i) => !!gp.buttons[i]?.pressed;
    let x = gp.axes[0] || 0;
    let y = gp.axes[1] || 0;
    if (b(14)) x = -1;
    if (b(15)) x = 1;
    if (b(12)) y = -1;
    if (b(13)) y = 1;
    const fire = b(0) || b(2) || b(7);
    const start = b(9);
    if (fire && !this.gpPrev.fire) this.pressed.add('GPFire');
    if (start && !this.gpPrev.start) this.pressed.add('GPStart');
    this.gpPrev = { fire, start };
    this.gp = { x, y, fire };
  }

  has(...codes) {
    return codes.some((c) => this.keys.has(c));
  }
  tapped(...codes) {
    return codes.some((c) => this.pressed.has(c));
  }

  get left() { return this.has('ArrowLeft', 'KeyA') || this.gp.x < -0.4 || this.touch.x < -0.35; }
  get right() { return this.has('ArrowRight', 'KeyD') || this.gp.x > 0.4 || this.touch.x > 0.35; }
  get up() { return this.has('ArrowUp', 'KeyW') || this.gp.y < -0.4 || this.touch.y < -0.45; }
  get down() { return this.has('ArrowDown', 'KeyS') || this.gp.y > 0.4 || this.touch.y > 0.45; }
  get fire() { return this.has('Space', 'KeyJ', 'KeyK', 'KeyX') || this.gp.fire || this.touch.fire; }
  // Taps can be shorter than a frame, so count presses from this frame too.
  get firePressed() { return this.tapped('Space', 'KeyJ', 'KeyK', 'KeyX', 'GPFire', 'TouchFire'); }
  get start() { return this.tapped('Enter', 'Space', 'GPStart', 'GPFire', 'Pointer', 'TouchFire'); }

  endFrame() {
    this.pressed.clear();
  }
}
