// Live indicators: output, chips/month, lead time, WIP, bottleneck, use of each process stage and operation,
// material handling, OEE of the bottleneck and what the plant is doing right now.
import { $ } from '../../../sim/ui/dom';
import type { Engine, Metrics } from '../engine';
import { SCENARIOS, STAGES, STEPS } from '../process';
import { bar, clock, hours, mi, minutes, num, pct } from './format';

export function createKpiPanel() {
  const stageBody = $('stage-rows'), stepBody = $('step-rows'), stList = $('st-list');
  const mkRow = (body: HTMLElement, name: string, sub?: string) => {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td></td><td></td><td></td>';
    tr.cells[0].textContent = name;
    if (sub) { const s = document.createElement('small'); s.textContent = sub; tr.cells[0].appendChild(s); }
    body.appendChild(tr);
    return tr;
  };
  const stageRows = STAGES.slice(1).map((n, i) => mkRow(stageBody, `${String(i + 1).padStart(2, '0')} ${n}`));
  const stepRows = STEPS.map(s => mkRow(stepBody, s.name, `${s.area} · ${s.tags.length ? `${s.tags.length} máq.` : 'buffer'}`));
  const states = ['Máquinas produzindo', 'Máquinas paradas (falha)', 'Máquinas aguardando lote', 'Lotes na fila', 'Lotes aguardando coleta', 'Lotes em transporte'].map(name => {
    const li = document.createElement('li');
    li.innerHTML = '<i class="pill"></i><span></span><em></em>';
    li.querySelector('span')!.textContent = name;
    stList.appendChild(li);
    return { pill: li.querySelector('.pill') as HTMLElement, em: li.querySelector('em') as HTMLElement };
  });
  const setUse = (td: HTMLTableCellElement, v: number) => { td.textContent = pct(v); td.appendChild(bar(v)); };

  function update(e: Engine) {
    const m: Metrics = e.metrics();
    const sinceDay = Math.floor(e.statsStart / 1440) + 1;
    $('k-clock').textContent = clock(e.now);
    $('k-scen').textContent = `${SCENARIOS.find(s => s.id === e.scenario)!.name} · média desde o dia ${sinceDay}`;
    $('k-lots').textContent = num(m.lotsPerDay, 1);
    $('k-chips').textContent = mi(m.chipsPerMonth);
    $('k-lead').textContent = m.lotsOut ? hours(m.leadTimeH) : '—';
    $('k-wip').textContent = num(m.wipAvg, 0);

    const bn = m.steps.find(s => s.key === m.bottleneck)!;
    const bott = $('k-bott');
    bott.textContent = `${bn.name} (${bn.area}) · ${pct(bn.util)} de utilização`;
    const sub = document.createElement('small');
    sub.textContent = `Fila média de ${num(bn.queueAvg, 1)} lotes, espera média de ${minutes(bn.waitAvgMin)} antes da máquina.`;
    bott.appendChild(sub);

    stageRows.forEach((tr, i) => {
      const ss = m.steps.filter(s => s.stage === i + 1 && s.machines > 0);
      const top = ss.reduce((a, b) => (b.util > a.util ? b : a), ss[0]);
      tr.className = ss.some(s => s.key === m.bottleneck) ? 'bn' : '';
      setUse(tr.cells[1], top.util);
      tr.cells[2].textContent = num(ss.reduce((n, s) => n + s.queueAvg, 0), 1);
    });
    stepRows.forEach((tr, i) => {
      const s = m.steps[i];
      tr.className = s.key === m.bottleneck ? 'bn' : '';
      if (s.machines) setUse(tr.cells[1], s.util); else tr.cells[1].textContent = '—';
      tr.cells[2].textContent = minutes(s.waitAvgMin);
    });

    const manual = e.fleet.kind === 'manual';
    $('k-fleet').textContent = String(e.carriers.length);
    $('k-fleet-l').textContent = manual ? `Operadores (${pct(e.fleet.share)} dedicados)` : 'AMRs';
    $('k-occ').textContent = pct(m.fleetUtil);
    $('k-wait').textContent = minutes(m.transportWaitMin);
    $('k-moves').textContent = num(m.movesPerDay, 0);

    $('o-av').textContent = pct(m.oee.availability);
    $('o-pf').textContent = pct(m.oee.performance);
    $('o-q').textContent = pct(m.oee.quality);
    $('o-oee').textContent = pct(m.oee.oee);

    let run = 0, down = 0, idle = 0;
    for (const mc of e.machines) { if (mc.down) down++; else if (mc.lots.length) run++; else idle++; }
    const queued = e.steps.reduce((n, s) => n + s.queue.length, 0);
    const moving = e.lots.filter(l => l.state === 'moving').length;
    const vals: [string, string][] = [
      ['run', String(run)], [down ? 'alarm' : 'off', String(down)], ['wait', String(idle)],
      ['wait', String(queued)], [e.pending ? 'wait' : 'off', String(e.pending)], ['run', String(moving)],
    ];
    vals.forEach(([s, v], i) => { states[i].pill.dataset.s = s; states[i].em.textContent = v; });
  }

  return { update };
}
