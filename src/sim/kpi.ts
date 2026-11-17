// Production indicators: UPH and a simulated OEE. Pure functions, no DOM.

/** Seconds of simulation before rates are shown (the first half-minute is too noisy). */
export const KPI_WARMUP_S = 30;

/** Units per hour from a count over t seconds, or null while t is too short. */
export const uph = (count: number, t: number): number | null => (t > KPI_WARMUP_S ? (count / t) * 3600 : null);

export const pct = (v: number) => `${Math.round(v * 100)}%`;

export interface OeeInput {
  /** Line output rate (units/h), or null if not known yet. */
  lineUph: number | null;
  /** Target rate (units/h). */
  target: number;
  /** Good units / inspected units. */
  good: number;
  inspected: number;
  /** Availability: 1 when the simulation has no stops or changeovers. */
  availability?: number;
}

export interface Oee { availability: number; performance: number | null; quality: number | null; oee: number | null }

/** OEE = availability × performance × quality. Performance is capped at 100% (running above target is not credited). */
export function oee({ lineUph, target, good, inspected, availability = 1 }: OeeInput): Oee {
  const performance = lineUph ? Math.min(1, lineUph / target) : null;
  const quality = inspected ? good / inspected : null;
  return { availability, performance, quality, oee: performance == null || quality == null ? null : availability * performance * quality };
}
