// Unified input: keyboard, mouse, touch (pointer events) and Gamepad API.
// Emits press / release (hold-to-spin), nose (attitude) deltas in degrees, and named actions.

export class Input {
  constructor(el, cb) {
    this.cb = cb; // { press, release, nose(deg), action(name) }
    this.held = false;
    this.keys = new Set();
    this.padHeld = false;
    this.padPrev = [];
    this.pad = null;
    this.pointerId = null;
    this.lastY = 0;
    this.sens = 0.22; // degrees of nose angle per pixel of drag
    this.el = el;

    const onKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      const onControl = t && (t.tagName === 'BUTTON' || t.tagName === 'A' || t.tagName === 'INPUT');
      if ((e.code === 'Space' || e.code === 'Enter') && !onControl) {
        e.preventDefault();
        if (!e.repeat && !this.held) this._press();
        return;
      }
      switch (e.code) {
        case 'ArrowUp':
        case 'KeyW':
        case 'ArrowDown':
        case 'KeyS':
          this.keys.add(e.code);
          e.preventDefault();
          break;
        case 'KeyR':
          this.cb.action('replay');
          break;
        case 'KeyM':
          this.cb.action('voice');
          break;
        case 'KeyH':
          this.cb.action('haptics');
          break;
        case 'KeyN':
          this.cb.action('next');
          break;
        case 'KeyC':
          if (!e.repeat) this.cb.action('camera');
          break;
        case 'KeyT':
          if (!e.repeat) this.cb.action('technique');
          break;
        case 'KeyP':
          if (!e.repeat) this.cb.action('player');
          break;
        case 'Slash':
        case 'F1':
        case 'KeyI':
          this.cb.action('help');
          e.preventDefault();
          break;
        case 'Escape':
          this.cb.action('close');
          break;
        default:
      }
    };
    const onKeyUp = (e) => {
      if ((e.code === 'Space' || e.code === 'Enter') && this.held && !this.padHeld && this.pointerId === null) {
        e.preventDefault();
        this._release();
      }
      this.keys.delete(e.code);
    };
    addEventListener('keydown', onKeyDown);
    addEventListener('keyup', onKeyUp);
    addEventListener('blur', () => {
      this.keys.clear();
      if (this.held) this._release();
    });

    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      this.pointerId = e.pointerId;
      this.lastY = e.clientY;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic events */
      }
      if (!this.held) this._press();
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointerId) return;
      const dy = this.lastY - e.clientY;
      this.lastY = e.clientY;
      if (dy) this.cb.nose(dy * this.sens);
    });
    const up = (e) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      if (this.held) this._release();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    addEventListener('gamepadconnected', (e) => cb.action('padconnected', e.gamepad));
    addEventListener('gamepaddisconnected', () => cb.action('paddisconnected'));
  }

  _press() {
    this.held = true;
    this.cb.press();
  }

  _release() {
    this.held = false;
    this.cb.release();
  }

  getPad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** Call every frame. */
  poll(dt) {
    let d = 0;
    if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) d += 30 * dt;
    if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) d -= 30 * dt;
    const p = this.getPad();
    this.pad = p;
    if (p) {
      const b = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
      const edge = (i) => b(i) && !this.padPrev[i];
      const ay = p.axes[1] || 0;
      if (Math.abs(ay) > 0.18) d += -ay * 45 * dt;
      if (b(12)) d += 30 * dt;
      if (b(13)) d -= 30 * dt;
      const hold = b(0) || b(7) || b(5);
      if (hold && !this.padHeld && !this.held) {
        this.padHeld = true;
        this._press();
      } else if (!hold && this.padHeld) {
        this.padHeld = false;
        if (this.held) this._release();
      }
      if (edge(2)) this.cb.action('replay');
      if (edge(3)) this.cb.action('camera'); // Y
      if (edge(4)) this.cb.action('help'); // LB
      if (edge(8)) this.cb.action('voice');
      if (edge(9)) this.cb.action('next');
      this.padPrev = p.buttons.map((x) => x.pressed);
    }
    if (d) this.cb.nose(d);
  }
}
