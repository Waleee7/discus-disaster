// Haptics: navigator.vibrate (Android/desktop Chromium; iOS Safari has none -> silently degrade)
// + Gamepad rumble via vibrationActuator.playEffect('dual-rumble') or legacy hapticActuators[0].pulse().

export class Haptics {
  constructor(getPad) {
    this.getPad = getPad; // () => Gamepad | null
    this.enabled = true;
    this.canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  }

  get canRumble() {
    const p = this.getPad();
    return !!(p && (p.vibrationActuator || (p.hapticActuators && p.hapticActuators.length)));
  }

  get available() {
    return this.canVibrate || this.canRumble;
  }

  vibrate(pattern) {
    if (!this.enabled || !this.canVibrate) return;
    try {
      navigator.vibrate(pattern);
    } catch {
      /* some browsers throw without a user gesture */
    }
  }

  rumble(duration = 80, weak = 0.3, strong = 0.3, startDelay = 0) {
    if (!this.enabled) return;
    const p = this.getPad();
    if (!p) return;
    try {
      if (p.vibrationActuator && p.vibrationActuator.playEffect) {
        p.vibrationActuator.playEffect('dual-rumble', { startDelay, duration, weakMagnitude: weak, strongMagnitude: strong });
      } else if (p.hapticActuators && p.hapticActuators[0] && p.hapticActuators[0].pulse) {
        p.hapticActuators[0].pulse(Math.max(weak, strong), duration);
      }
    } catch {
      /* controller disconnected mid-effect */
    }
  }

  /** Spin tick: fires once per half-turn; intensity follows power. */
  tick(power = 0) {
    this.vibrate(6 + Math.round(power * 10));
    this.rumble(40, 0.1 + power * 0.35, 0.05 + power * 0.2);
  }

  release(power = 0.5) {
    this.vibrate([30, 20, 20 + Math.round(power * 60)]);
    this.rumble(160, 0.4, 0.4 + power * 0.5);
  }

  land() {
    this.vibrate([40, 30, 90]);
    this.rumble(220, 0.2, 0.9);
  }

  hit() {
    this.vibrate([20, 20, 20, 20, 60]);
    this.rumble(260, 0.9, 0.55);
  }

  foul() {
    this.vibrate([140, 70, 140]);
    this.rumble(380, 0.7, 0.2);
  }

  perfect() {
    this.vibrate([15, 30, 15, 30, 15, 30, 90]);
    this.rumble(300, 0.6, 0.6);
  }
}
