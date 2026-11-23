// Parameters tab: arms on/off, work split (the UPH target is the line cadence of the model). Saved in the browser for the next visit.
import type { Arms, Mode, World } from '../types';
import { applyArms, resetLine } from '../world';
import { $ } from '../../../sim/ui/dom';

const PKEY = 'transferflow3d.params.v1';
type Saved = { arms: Arms; mode: Mode };

export function createParamsPanel(w: World, onApplied: () => void) {
  const form = $<HTMLFormElement>('params'), pMode = $<HTMLSelectElement>('p-mode');
  const pStatus = $('p-status'), fsMode = $<HTMLFieldSetElement>('fs-mode');

  const readForm = (): Saved => ({
    arms: ((form.querySelector('input[name="arms"]:checked') as HTMLInputElement | null)?.value as Arms) || 'both',
    mode: pMode.value as Mode,
  });
  const writeForm = (p: Saved) => {
    const el = document.getElementById(`arms-${p.arms}`) as HTMLInputElement | null;
    if (el) el.checked = true;
    pMode.value = p.mode;
    fsMode.disabled = p.arms !== 'both';
  };
  function apply(p: Saved, restart: boolean) {
    w.params.arms = p.arms;
    w.params.mode = p.mode;
    applyArms(w);
    if (restart) resetLine(w);
    onApplied();
  }

  /** Load the saved parameters (or defaults) and apply them without restarting the line. */
  function init() {
    let p: Saved = { arms: 'both', mode: 'auto' };
    try {
      const s = JSON.parse(localStorage.getItem(PKEY) || 'null');
      if (s && typeof s === 'object') p = { arms: s.arms ?? p.arms, mode: s.mode ?? p.mode };
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
    pStatus.textContent = `Aplicado: ${arms}. Linha reiniciada.`;
  });

  return { init };
}
