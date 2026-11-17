// "Gerar PNG" dialog: resolution, aspect, labels; shows the image and offers it as a download.
import type * as THREE from 'three';
import type { Labels } from '../../../sim/labels';
import { renderShot } from '../../../sim/shot';
import type { Stage } from '../../../sim/stage';
import { $ } from './dom';

export function createShotModal(stage: Stage, labels: Labels, beforeRender: (camera: THREE.PerspectiveCamera) => void, fileName: (W: number, H: number) => string) {
  const modal = $('modal');
  const img = $<HTMLImageElement>('shot'), info = $('shot-info'), dl = $<HTMLAnchorElement>('shot-dl');
  const go = $<HTMLButtonElement>('shot-go'), res = $<HTMLSelectElement>('shot-res'), asp = $<HTMLSelectElement>('shot-aspect'), lbl = $<HTMLInputElement>('shot-labels');
  $('shot-help').hidden = true; // hosted page: the download link works
  let url: string | null = null;

  function make() {
    go.disabled = true;
    info.textContent = 'Gerando…';
    // let the "Gerando…" message paint before the heavy render
    setTimeout(() => {
      let r;
      try {
        r = renderShot(stage, labels, beforeRender, { width: Number(res.value), aspect: asp.value === 'view' ? 'view' : Number(asp.value), withLabels: lbl.checked });
      } catch {
        info.textContent = 'A placa de vídeo não conseguiu gerar essa resolução. Escolha uma menor e tente de novo.';
        go.disabled = false;
        return;
      }
      r.canvas.toBlob(blob => {
        go.disabled = false;
        if (!blob) { info.textContent = 'Não foi possível montar o PNG. Escolha uma resolução menor e tente de novo.'; return; }
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(blob);
        img.src = url;
        const mb = (blob.size / 1048576).toFixed(1);
        info.textContent = `${r.W} × ${r.H} px · suavização ${r.ss.toFixed(1).replace('.0', '')}× · sombras ${r.shadow} px · ${mb} MB` + (r.capped ? ' · limitado pela placa de vídeo' : '');
        dl.href = url;
        dl.download = fileName(r.W, r.H);
        dl.hidden = false;
      }, 'image/png');
    }, 30);
  }

  $('b-shot').onclick = () => { modal.hidden = false; make(); };
  $('shot-form').addEventListener('submit', e => { e.preventDefault(); make(); });
  $('b-close').onclick = () => (modal.hidden = true);
  modal.addEventListener('click', e => { if (e.target === modal) modal.hidden = true; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') modal.hidden = true; });
}
