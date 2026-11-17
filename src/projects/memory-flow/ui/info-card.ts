// Card for the equipment clicked in the 3D: tag, area, role in the route, state, use and output.
import { $ } from '../../../sim/ui/dom';
import type { Engine, Machine } from '../engine';
import { ZONES, areaById, type Equip } from '../layout';
import { KIND_NAME } from '../machines';
import { FAMILY_INFO } from '../process';
import { num, pct } from './format';

export function createInfoCard(onClose: () => void) {
  const box = $('info'), title = $('info-title'), sub = $('info-sub'), dl = $('info-dl');
  let current: Equip | null = null;
  $('info-close').onclick = () => close();

  function close() { box.hidden = true; current = null; onClose(); }

  function row(k: string, v: string | Node) {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = k;
    dd.append(v);
    dl.append(dt, dd);
  }

  function render(e: Engine) {
    if (!current) return;
    const eq = current, area = areaById(eq.area);
    title.textContent = `${eq.area} · ${eq.tag}`;
    sub.textContent = `${KIND_NAME[eq.kind]} · ${area.name}`;
    dl.textContent = '';
    const m: Machine | undefined = e.machines.find(x => x.eq === eq || x.linked === eq);
    if (m) {
      const T = Math.max(1, e.now - e.statsStart);
      const state = m.down ? ['alarm', 'Parada por falha'] : m.lots.length ? ['run', 'Produzindo'] : ['wait', 'Aguardando lote'];
      const pill = document.createElement('i');
      pill.className = 'pill';
      pill.dataset.s = state[0];
      const st = document.createElement('span');
      st.append(pill, state[1]);
      row('Estado', st);
      row('Operação', m.step.def.name + (m.linked === eq ? ` (com ${m.eq.tag})` : m.linked ? ` (com ${m.linked.tag})` : ''));
      if (m.lots.length) row('Lote agora', m.lots.map(l => `#${l.id} ${FAMILY_INFO[l.fam].name}`).join(', '));
      row('Utilização', pct(m.busyInt / (m.slots * T)));
      row('Lotes feitos', `${m.done} (${num((m.done / T) * 1440, 1)}/dia)`);
      row('Paradas', String(m.stops));
      row('Tempo de ciclo', `${num(m.step.minutes, 0)} min/lote${m.slots > 1 ? ` · ${m.slots} lotes por vez` : ''}`);
      row('Fila na área', `${m.step.queue.length} lotes`);
      if (eq.area === 'P01C' && m.step.def.key === 'INS') {
        const a = document.createElement('a');
        a.href = 'inspecao/';
        a.className = 'cell-link';
        a.textContent = 'Abrir a célula com IA que substitui as bancadas';
        row('Proposta', a);
      }
    } else if (area.zone === 'fac') {
      row('Função', 'Utilidade da planta');
      row('Monitoramento', 'Frente Utilities: tendências e alertas com o histórico existente (a avaliar)');
    } else if (eq.access) {
      row('Função', 'Laboratório ou apoio: fora do roteiro de produção modelado');
    } else {
      row('Função', ZONES[area.zone].name);
    }
    row('Posição', `x ${num(eq.x, 1)} m · y ${num(eq.z, 1)} m`);
    row('Volume', `${num(eq.w, 1)} × ${num(eq.d, 1)} × ${num(eq.h, 1)} m (simbólico)`);
    if (eq.prov) row('TAG', 'Provisório: posição sem TAG na planta');
  }

  return {
    open(eq: Equip, e: Engine) { current = eq; box.hidden = false; render(e); },
    update(e: Engine) { if (current) render(e); },
    close,
    get current() { return current; },
  };
}
