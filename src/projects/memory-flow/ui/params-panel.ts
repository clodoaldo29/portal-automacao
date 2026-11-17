// Parameters tab: release and mix, manual handling, AMRs and AI inspection, machine availability and the cycle
// time of every operation. Saved in the browser for the next visit.
import { $ } from '../../../sim/ui/dom';
import { DEFAULT_PARAMS, FAMILIES, FAMILY_INFO, STEPS, WAFERS_PER_LOT, chipsPerWafer, cloneParams, type Params } from '../process';
import { mi } from './format';

const PKEY = 'memoryflow3d.params.v1';

export function createParamsPanel(onApply: (p: Params) => void) {
  const form = $<HTMLFormElement>('params'), status = $('p-status');
  const release = $<HTMLInputElement>('p-release'), releaseH = $('p-release-h');
  const field = (id: string) => $<HTMLInputElement>(id);

  // mix inputs
  const mixBox = $('p-mix');
  const mixIn = Object.fromEntries(FAMILIES.map(f => {
    const l = document.createElement('label');
    const sw = document.createElement('i');
    sw.style.background = `#${FAMILY_INFO[f].color.toString(16).padStart(6, '0')}`;
    const inp = document.createElement('input');
    inp.type = 'number'; inp.min = '0'; inp.max = '100'; inp.step = '1'; inp.inputMode = 'numeric';
    inp.setAttribute('aria-label', `Mix ${FAMILY_INFO[f].name} (%)`);
    l.append(sw, f === 'EMMC' ? 'eMMC' : f, inp);
    mixBox.appendChild(l);
    return [f, inp];
  })) as Record<string, HTMLInputElement>;

  // cycle time table
  const stepTable = $<HTMLTableElement>('p-steps');
  const stepIn = new Map<string, HTMLInputElement>();
  for (const s of STEPS) {
    const tr = stepTable.insertRow();
    const td = tr.insertCell();
    td.textContent = s.key === 'INS' ? `${s.name} (manual)` : s.name;
    const sm = document.createElement('small');
    sm.textContent = `${s.area}${s.slots ? ` · ${s.slots} lotes/forno` : ''}`;
    td.appendChild(sm);
    const inp = document.createElement('input');
    inp.type = 'number'; inp.min = '1'; inp.max = '5000'; inp.step = '1'; inp.inputMode = 'numeric';
    inp.setAttribute('aria-label', `${s.name}: minutos por lote`);
    tr.insertCell().appendChild(inp);
    stepIn.set(s.key, inp);
  }

  const n = (inp: HTMLInputElement, def: number, lo: number, hi: number) => {
    const v = Number(inp.value);
    return Number.isFinite(v) && inp.value !== '' ? Math.min(hi, Math.max(lo, v)) : def;
  };
  function read(): Params {
    const d = DEFAULT_PARAMS, p = cloneParams(d);
    p.release = n(release, d.release, 1, 60);
    for (const f of FAMILIES) p.mix[f] = n(mixIn[f], d.mix[f], 0, 100);
    if (FAMILIES.every(f => p.mix[f] === 0)) p.mix = { ...d.mix };
    p.operators = Math.round(n(field('p-ops'), d.operators, 1, 40));
    p.share = n(field('p-share'), d.share * 100, 10, 100) / 100;
    p.record = n(field('p-record'), d.record, 0, 30);
    p.amrs = Math.round(n(field('p-amrs'), d.amrs, 1, 30));
    p.insAi = n(field('p-insai'), d.insAi, 1, 600);
    p.avail = n(field('p-avail'), d.avail * 100, 50, 100) / 100;
    p.mttr = n(field('p-mttr'), d.mttr, 5, 1440);
    p.minutes = {};
    for (const s of STEPS) { const v = n(stepIn.get(s.key)!, s.minutes, 1, 5000); if (v !== s.minutes) p.minutes[s.key] = v; }
    return p;
  }
  function write(p: Params) {
    release.value = String(p.release);
    for (const f of FAMILIES) mixIn[f].value = String(p.mix[f]);
    field('p-ops').value = String(p.operators);
    field('p-share').value = String(Math.round(p.share * 100));
    field('p-record').value = String(p.record);
    field('p-amrs').value = String(p.amrs);
    field('p-insai').value = String(p.insAi);
    field('p-avail').value = String(Math.round(p.avail * 100));
    field('p-mttr').value = String(p.mttr);
    for (const s of STEPS) stepIn.get(s.key)!.value = String(p.minutes[s.key] ?? s.minutes);
    hint();
  }
  function hint() {
    const p = read();
    releaseH.textContent = `≈ ${mi(p.release * WAFERS_PER_LOT * chipsPerWafer(p.mix) * 30)} chips/mês com este mix (${Math.round(chipsPerWafer(p.mix))} chips por wafer, em média). Capacidade histórica do documento: 5 milhões/mês.`;
  }

  /** Saved parameters (or defaults). */
  function load(): Params {
    let p = cloneParams(DEFAULT_PARAMS);
    try {
      const s = JSON.parse(localStorage.getItem(PKEY) || 'null');
      if (s && typeof s === 'object') { write({ ...p, ...s, mix: { ...p.mix, ...s.mix }, minutes: { ...s.minutes } }); p = read(); }
    } catch { /* storage blocked or invalid: defaults */ }
    write(p);
    return p;
  }

  form.addEventListener('input', hint);
  form.addEventListener('submit', e => {
    e.preventDefault();
    const p = read();
    write(p);
    try { localStorage.setItem(PKEY, JSON.stringify(p)); } catch { /* not saved: still applied */ }
    onApply(p);
    status.textContent = 'Aplicado. A planta foi reiniciada com os novos valores.';
  });
  $('p-reset').onclick = () => {
    write(cloneParams(DEFAULT_PARAMS));
    try { localStorage.removeItem(PKEY); } catch { /* ignore */ }
    onApply(read());
    status.textContent = 'Valores padrão restaurados. A planta foi reiniciada.';
  };

  return { load, read };
}
