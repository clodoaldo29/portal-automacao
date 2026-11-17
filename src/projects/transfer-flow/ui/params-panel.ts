// Parameters tab: arms on/off, work split, UPH target. Saved in the browser for the next visit.
import type { Arms, Mode, World } from '../types';
import { applyArms, resetLine } from '../world';
import { $ } from './dom';

const PKEY = 'transferflow3d.params.v1';
type Saved = { arms: Arms; mode: Mode; uph: number };

export function createParamsPanel(w: World, onApplied: () => void) {
  const form = $<HTMLFormElement>('params'), pMode = $<HTMLSelectElement>('p-mode'), pUph = $<HTMLInputElement>('p-uph');
  const pStatus = $('p-status'), fsMode = $<HTMLFieldSetElement>('fs-mode');

  const readForm = (): Saved => ({
    arms: ((form.querySelector('input[name="arms"]:checked') as HTMLInputElement | null)?.value as Arms) || 'both',
    mode: pMode.value as Mode,
    uph: Math.max(1, Math.round(Number(pUph.value) || 600)),
  });
  const writeForm = (p: Saved) => {
    const el = document.getElementById(`arms-${p.arms}`) as HTMLInputElement | null;
    if (el) el.checked = true;
    pMode.value = p.mode;
    pUph.value = String(p.uph);
    fsMode.disabled = p.arms !== 'both';
  };
  function apply(p: Saved, restart: boolean) {
    w.params.arms = p.arms;
    w.params.mode = p.mode;
    w.params.uphTarget = p.uph;
    applyArms(w);
    if (restart) resetLine(w);
    onApplied();
  }

  /** Load the saved parameters (or defaults) and apply them without restarting the line. */
  function init() {
    let p: Saved = { arms: 'both', mode: 'auto', uph: 600 };
    try {
      const s = JSON.parse(localStorage.getItem(PKEY) || 'null');
      if (s && typeof s === 'object') p = Object.assign(p, s);
    } catch { /* storage blocked: defaults */ }
    if (!['both', 't1', 't2'].includes(p.arms)) p.arms = 'both';
    if (!['auto', 'free', 'A', 'B'].includes(p.mode)) p.mode = 'auto';
    writeForm(p);
    apply(p, false);
  }

  form.addEventListener('change', () => { fsMode.disabled = readForm().arms !== 'both'; });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const p = readForm();
    writeForm(p);
    try { localStorage.setItem(PKEY, JSON.stringify(p)); } catch { /* not saved: still applied */ }
    apply(p, true);
    const arms = p.arms === 'both' ? 'dois braços' : p.arms === 't1' ? 'só o Transfer 1' : 'só o Transfer 2';
    pStatus.textContent = `Aplicado: ${arms}, meta ${p.uph} TV/h. Linha reiniciada.`;
  });

  return { init };
}
