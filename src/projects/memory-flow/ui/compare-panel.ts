// "Comparar" tab: the three scenarios side by side with the same parameters and lot sequence, at the current
// release and at a release 33% higher (how much headroom each scenario has).
import { $ } from '../../../sim/ui/dom';
import { runScenario, type Metrics } from '../engine';
import { SCENARIOS, STEPS, cloneParams, type Params } from '../process';
import { hours, mi, minutes, num, pct } from './format';

type Row = [label: string, get: (m: Metrics) => number, fmt: (v: number) => string, better: 'hi' | 'lo' | null];
const ROWS: Row[] = [
  ['Lotes por dia', m => m.lotsPerDay, v => num(v, 1), 'hi'],
  ['Chips por mês', m => m.chipsPerMonth, mi, 'hi'],
  ['Lead time', m => m.leadTimeH, hours, 'lo'],
  ['WIP médio (lotes)', m => m.wipAvg, v => num(v, 0), 'lo'],
  ['Espera por coleta', m => m.transportWaitMin, minutes, 'lo'],
  ['Eficiência de fluxo', m => m.flowEfficiency, pct, 'hi'],
  ['Ocupação da frota', m => m.fleetUtil, pct, null],
  ['OEE do gargalo', m => m.oee.oee, pct, null],
];

function table(caption: string, res: Metrics[]) {
  const t = document.createElement('table');
  t.className = 'cmp';
  t.createCaption().textContent = caption;
  const head = t.createTHead().insertRow();
  ['', ...SCENARIOS.map(s => s.short)].forEach(h => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = h; head.appendChild(th); });
  const body = t.createTBody();
  for (const [label, get, fmt, better] of ROWS) {
    const tr = body.insertRow();
    tr.insertCell().textContent = label;
    const vals = res.map(get);
    const best = better === 'hi' ? Math.max(...vals) : better === 'lo' ? Math.min(...vals) : NaN;
    vals.forEach(v => {
      const td = tr.insertCell();
      td.textContent = fmt(v);
      if (better && Math.abs(v - best) < 1e-9 && new Set(vals.map(x => x.toFixed(6))).size > 1) td.className = 'best';
    });
  }
  const tr = body.insertRow();
  tr.insertCell().textContent = 'Gargalo';
  res.forEach(m => {
    const td = tr.insertCell(), s = STEPS.find(x => x.key === m.bottleneck)!;
    td.textContent = s.key;
    const sm = document.createElement('small');
    sm.textContent = pct(m.steps.find(x => x.key === m.bottleneck)!.util);
    td.appendChild(sm);
    td.title = s.name;
  });
  return t;
}

export function createComparePanel(getParams: () => Params) {
  const btn = $<HTMLButtonElement>('c-run'), out = $('c-out');
  let ran = false;

  function run() {
    btn.disabled = true;
    out.textContent = 'Calculando 3 cenários × 21 dias…';
    setTimeout(() => {
      const p = getParams(), t0 = performance.now();
      const base = SCENARIOS.map(s => runScenario(p, s.id));
      const hi = cloneParams(p);
      hi.release = Math.round(p.release * 1.33 * 2) / 2;
      const stress = SCENARIOS.map(s => runScenario(hi, s.id));
      out.textContent = '';
      out.append(table(`Liberação de ${num(p.release, 1)} lotes/dia`, base), table(`Liberação de ${num(hi.release, 1)} lotes/dia (+33%)`, stress));
      const note = document.createElement('p');
      note.className = 'note';
      note.textContent = `Verde: melhor valor da linha. Quando uma liberação passa da capacidade de um cenário, a fila cresce sem parar: os lotes por dia ficam abaixo do liberado e o lead time dispara. Calculado em ${Math.round(performance.now() - t0)} ms.`;
      out.append(note);
      btn.disabled = false;
      ran = true;
    }, 30);
  }
  btn.onclick = run;

  return { run, get ran() { return ran; }, invalidate() { ran = false; out.textContent = ''; } };
}
