// Number formatting for the panels (Brazilian Portuguese).
export const num = (v: number, d = 1) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const mi = (v: number) => `${num(v / 1e6, 2)} mi`;
export const hours = (v: number) => `${num(v, 1)} h`;
export const minutes = (v: number) => (v >= 90 ? `${num(v / 60, 1)} h` : `${num(v, v < 10 ? 1 : 0)} min`);

/** Simulated clock: "Dia 15 · 06:32". */
export function clock(tMin: number) {
  const day = Math.floor(tMin / 1440) + 1, m = Math.floor(tMin % 1440);
  return `Dia ${day} · ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Usage bar as in the Transfer Flow panel, red from 85%, amber from 65%. */
export function bar(v: number) {
  const b = document.createElement('span');
  b.className = 'bar-cell';
  const i = document.createElement('i');
  i.style.width = pct(Math.min(1, v));
  if (v >= 0.85) i.className = 'hot';
  else if (v >= 0.65) i.className = 'warm';
  b.appendChild(i);
  return b;
}
