export const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

/** Smoothstep easing on [0, 1]. */
export const ease = (u: number): number => u * u * (3 - 2 * u);
