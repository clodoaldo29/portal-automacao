// Live indicators: line UPH and target, UPH and occupancy per cell (vision → transfers → line output), simulated OEE,
// and the state of each station.
import { oee, pct, uph } from '../../../sim/kpi';
import { LINE_UPH, type Inch } from '../config';
import type { Transfer, World } from '../types';
import { $ } from '../../../sim/ui/dom';

export function createKpiPanel(w: World) {
  const stList = $('st-list');
  const rows = ['Inspeção IA', 'Transfer 1', 'Transfer 2'].map(name => {
    const li = document.createElement('li');
    li.innerHTML = '<i class="pill"></i><span></span><em></em>';
    li.querySelector('span')!.textContent = name;
    stList.appendChild(li);
    return { pill: li.querySelector('.pill') as HTMLElement, em: li.querySelector('em') as HTMLElement };
  });
  const setRow = (i: number, s: string, text: string) => { rows[i].pill.dataset.s = s; rows[i].em.textContent = text; };
  const robotText = (r: Transfer): [string, string] =>
    !r.enabled ? ['off', 'Desligado nos parâmetros']
      : r.state === 'pick' ? ['run', 'Pegando TV']
        : r.state === 'place' ? ['run', 'Colocando no pallet']
          : r.state === 'waitPallet' ? ['wait', 'Aguardando pallet']
            : r.state === 'return' ? ['run', 'Retornando'] : ['wait', 'Livre'];

  const cellRows = $('cell-rows');
  const mkCell = (name: string, total = false) => {
    const tr = document.createElement('tr');
    if (total) tr.className = 'total';
    tr.innerHTML = '<td></td><td></td><td></td>';
    tr.cells[0].textContent = name;
    cellRows.appendChild(tr);
    return tr;
  };
  const cells = { insp: mkCell('Inspeção IA'), t1: mkCell('Transfer 1'), t2: mkCell('Transfer 2'), line: mkCell('Linha (saída)', true) };
  // expected UPH of every model (the line cadence), the running model highlighted with what the simulation does
  const modelRows = $('model-rows');
  const models = (Object.keys(LINE_UPH).map(Number) as Inch[]).map(inch => {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td></td><td></td><td></td>';
    tr.cells[0].textContent = `${inch}″`;
    tr.cells[1].textContent = `${LINE_UPH[inch]} TV/h`;
    modelRows.appendChild(tr);
    return { inch, tr };
  });
  const fmtUph = (n: number, t: number) => { const v = uph(n, t); return v == null ? '—' : String(Math.round(v)); };
  const occCell = (td: HTMLTableCellElement, v: number | null, sub?: string) => {
    td.innerHTML = '';
    td.append(v == null ? '—' : pct(v));
    if (v != null) {
      const b = document.createElement('span');
      b.className = 'bar-cell';
      const i = document.createElement('i');
      i.style.width = pct(Math.min(1, v));
      b.appendChild(i);
      td.appendChild(b);
    }
    if (sub) { const s = document.createElement('small'); s.textContent = sub; td.appendChild(s); }
  };
  const uphCell = (td: HTMLTableCellElement, v: string, sub?: string) => {
    td.textContent = v;
    if (sub) { const s = document.createElement('small'); s.textContent = sub; td.appendChild(s); }
  };

  function update() {
    const { stats, insp, robots, params } = w;
    const t = stats.simT, ready = uph(1, t) != null;
    const lineUph = stats.moved ? uph(stats.moved, t) : null;
    const target = LINE_UPH[params.inch];
    $('k-prod').textContent = String(stats.moved);
    $('k-rate').textContent = lineUph ? String(Math.round(lineUph)) : '—';
    $('k-target').textContent = lineUph ? pct(lineUph / target) : '—';
    $('k-target-l').textContent = `do UPH esperado do ${params.inch}″ (${target} TV/h)`;
    for (const m of models) {
      const on = m.inch === params.inch;
      m.tr.className = on ? 'total' : '';
      m.tr.cells[2].textContent = on ? (lineUph ? `${Math.round(lineUph)} TV/h` : '—') : '';
    }
    $('k-cycle').textContent = lineUph ? `${(3600 / lineUph).toFixed(1)} s` : '—';
    const tot = stats.ok + stats.ng;
    $('k-yield').textContent = tot ? pct(stats.ok / tot) : '—';
    $('k-ng').textContent = String(stats.ng);

    uphCell(cells.insp.cells[1], fmtUph(stats.inspTV, t), 'TVs inspecionadas');
    occCell(cells.insp.cells[2], ready ? insp.busyT / t : null);
    robots.forEach((r, i) => {
      const row = i === 0 ? cells.t1 : cells.t2;
      row.className = r.enabled ? '' : 'off';
      if (!r.enabled) { uphCell(row.cells[1], '—', 'desligado'); occCell(row.cells[2], null); return; }
      uphCell(row.cells[1], fmtUph(r.count, t), `${r.count} TVs`);
      occCell(row.cells[2], ready && r.totT ? r.busyT / r.totT : null, ready && r.totT ? `${pct(r.palT / r.totT)} esperando pallet` : '');
    });
    uphCell(cells.line.cells[1], lineUph ? String(Math.round(lineUph)) : '—', `meta ${target}`);
    occCell(cells.line.cells[2], null);

    // OEE (simulated: no breakdowns or changeovers, so availability is 100%)
    const o = oee({ lineUph, target, good: stats.okTV, inspected: stats.inspTV });
    $('o-av').textContent = pct(o.availability);
    $('o-pf').textContent = o.performance == null ? '—' : pct(o.performance);
    $('o-q').textContent = o.quality == null ? '—' : pct(o.quality);
    $('o-oee').textContent = o.oee == null ? '—' : pct(o.oee);

    setRow(0, insp.alarmT > 0 ? 'alarm' : insp.state === 'scan' ? 'run' : 'wait', insp.alarmT > 0 ? 'NG detectada' : insp.state === 'scan' ? 'Inspecionando' : 'Aguardando peça');
    robots.forEach((r, i) => { const [s, txt] = robotText(r); setRow(1 + i, s, txt); });
  }

  return { update };
}
