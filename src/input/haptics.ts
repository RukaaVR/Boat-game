/**
 * Gamepad haptics with feature detection.
 *
 * Chromium exposes `vibrationActuator.playEffect('dual-rumble', …)`; some
 * browsers only expose the older `hapticActuators[0].pulse(value, ms)`. Pads
 * with neither are skipped silently. Every call is best-effort: unsupported
 * actuators reject their promise and that is fine.
 */

import { clamp } from '../core/mathx';

type DualRumble = { playEffect?: (type: string, params: object) => Promise<unknown> };
type LegacyHaptic = { pulse?: (value: number, ms: number) => Promise<unknown> };

const ignore = () => {
  /* haptics are best-effort */
};

/** One rumble pulse on one pad. `strong` = low-frequency motor, `weak` = high-frequency motor. */
export function pulsePad(p: Gamepad | null | undefined, strong: number, weak: number, ms: number) {
  if (!p || ms <= 0) return;
  const s = clamp(strong, 0, 1);
  const w = clamp(weak, 0, 1);
  const a = (p as unknown as { vibrationActuator?: DualRumble }).vibrationActuator;
  if (a?.playEffect) {
    try {
      a.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: s, weakMagnitude: w }).catch(ignore);
    } catch {
      /* a throwing implementation is treated as unsupported */
    }
    return;
  }
  const h = (p as unknown as { hapticActuators?: readonly LegacyHaptic[] }).hapticActuators;
  const legacy = h?.[0];
  if (legacy?.pulse) {
    try {
      legacy.pulse(Math.max(s, w), ms).catch(ignore);
    } catch {
      /* unsupported */
    }
  }
}
