/**
 * Accessibility multipliers read by render code each frame (set from the
 * settings). Kept as one tiny shared object so hot paths don't need plumbing.
 */
export const A11Y = {
  /** Scales full-screen flashes (lightning, impact frames, white-outs). */
  flash: 1,
  /** Scales particle emission (spray, sparks, dust). */
  particles: 1,
};
