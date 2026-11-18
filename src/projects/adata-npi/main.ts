// Project 04 · Adata Technology: NPI platform prototype (screens only, no 3D).
// State lives in the browser (localStorage); "Restaurar exemplo" brings back the sample data.
import {
  COMPARE, STAGES, blockers, current, diff, editParam, familyName, inUse, outOfRange, sampleProducts, stageOf,
  stepArea, stepName, type Product, type Recipe, type RecipeVersion,
} from './data';

const KEY = 'adata04.npi.v1';
type Role = 'eng' | 'qual' | 'prod';
const WHO: Record<Role, string> = { eng: 'Engenharia · R. Lima', qual: 'Qualidade · M. Souza', prod: 'Produção · A. Costa' };
const STATUS_TEXT = { rascunho: 'Rascunho', 'em-aprovacao': 'Em aprovação', aprovado: 'Aprovado' } as const;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { cls?: string } = {}, ...kids: (Node | string | null)[]) {
  const n = document.createElement(tag);
  const { cls, ...rest } = props;
  if (cls) n.className = cls;
  Object.assign(n, rest);
  kids.forEach(k => k != null && n.append(k));
  return n;
}
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR');
const tag = (status: keyof typeof STATUS_TEXT) => el('span', { cls: `tag ${status}`, textContent: STATUS_TEXT[status] });

// ---------- state ----------
let products: Product[] = load();
let sel = 0, recipeSel = 0, versionSel: number | null = null;
let role: Role = 'eng';
function load(): Product[] {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (Array.isArray(s) && s.length) return s; } catch { /* sample data */ }
  return sampleProducts();
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(products)); } catch { /* not saved */ } }
const P = () => products[sel];
function log(what: string) { P().history.push({ date: today(), who: WHO[role], what }); }
let toastT = 0;
function toast(msg: string) {
  document.querySelector('.toast')?.remove();
  const t = el('div', { cls: 'toast', textContent: msg });
  t.setAttribute('role', 'status');
  document.body.appendChild(t);
  clearTimeout(toastT);
  toastT = window.setTimeout(() => t.remove(), 2600);
}

// ---------- product list and header ----------
function renderProducts() {
  const ul = $('products');
  ul.textContent = '';
  products.forEach((p, i) => {
    const st = STAGES.find(s => s.id === stageOf(p))!;
    const b = el('button', { type: 'button' }, el('b', { textContent: p.name }), el('small', { textContent: `${p.pn} · ${st.name}` }));
    b.setAttribute('aria-current', String(i === sel));
    b.onclick = () => { sel = i; recipeSel = 0; versionSel = null; render(); };
    ul.appendChild(el('li', {}, b));
  });
}
function renderHead() {
  const p = P();
  $('p-pn').textContent = `${p.pn} · rev. ${p.rev}`;
  $('p-name').textContent = p.name;
  $('p-meta').textContent = `${familyName(p.family)} · ${p.pkg} · ${p.route.length} operações na rota`;
  const now = STAGES.findIndex(s => s.id === stageOf(p));
  const ol = $('stepper');
  ol.textContent = '';
  STAGES.forEach((s, i) => {
    const li = el('li', { textContent: s.name, cls: i < now || (s.id === 'liberado' && p.released) ? 'done' : i === now ? 'now' : '' });
    if (i === now) li.setAttribute('aria-current', 'step');
    ol.appendChild(li);
  });
}

// ---------- tabs ----------
function renderRoute() {
  const p = P(), v = $('v-rota');
  v.textContent = '';
  const t = el('table', { cls: 't' });
  t.innerHTML = '<thead><tr><th scope="col">#</th><th scope="col">Operação</th><th scope="col">Área</th><th scope="col">Receita</th><th scope="col">Instrução</th></tr></thead>';
  const body = el('tbody');
  p.route.forEach((k, i) => {
    const r = p.recipes.find(x => x.step === k), ins = p.instructions.find(x => x.step === k);
    const tr = el('tr');
    tr.append(el('td', { cls: 'num', textContent: String(i + 1) }), el('td', { textContent: stepName(k) }), el('td', {}, el('span', { cls: 'tag area', textContent: stepArea(k) })));
    tr.append(el('td', {}, r ? tag(current(r).status) : '—'), el('td', {}, ins ? tag(ins.status) : '—'));
    body.appendChild(tr);
  });
  t.appendChild(body);
  v.append(t, el('p', { cls: 'hint', textContent: `Rota da família ${familyName(p.family)}, tirada do roteiro da planta (Memory Flow).${p.family === 'DDR4' || p.family === 'DDR5' ? ' Inclui burn-in, só para DRAM.' : ''}` }));
}

function renderRecipes() {
  const p = P(), v = $('v-receitas');
  v.textContent = '';
  if (!p.recipes.length) { v.textContent = 'Esta rota não tem operações com receita.'; return; }
  recipeSel = Math.min(recipeSel, p.recipes.length - 1);
  const r = p.recipes[recipeSel], cur = current(r);
  const shown: RecipeVersion = r.versions.find(x => x.v === versionSel) ?? cur;
  const editable = role === 'eng' && !p.released && shown === cur;
  const list = el('div', { cls: 'list' });
  p.recipes.forEach((x, i) => {
    const b = el('button', { type: 'button' }, el('span', { textContent: stepName(x.step) }), tag(current(x).status));
    b.setAttribute('aria-current', String(i === recipeSel));
    b.onclick = () => { recipeSel = i; versionSel = null; renderRecipes(); };
    list.appendChild(b);
  });
  const box = el('div');
  const vers = el('div', { cls: 'versions' });
  r.versions.forEach(x => {
    const b = el('button', { type: 'button', textContent: `v${x.v}` });
    b.setAttribute('aria-pressed', String(x === shown));
    b.title = `${STATUS_TEXT[x.status]} · ${x.author} · ${fmtDate(x.date)}`;
    b.onclick = () => { versionSel = x.v; renderRecipes(); };
    vers.appendChild(b);
  });
  const used = inUse(r);
  box.appendChild(el('div', { cls: 'recipe-head' }, el('h3', { textContent: `${stepName(r.step)} · v${shown.v}` }), tag(shown.status), vers));
  box.appendChild(el('p', { cls: 'hint', textContent: `${shown.author} · ${fmtDate(shown.date)}${shown.approvedBy ? ` · aprovada por ${shown.approvedBy}` : ''}. Na máquina: ${used ? `v${used.v}` : 'nenhuma versão aprovada'}.` }));
  const t = el('table', { cls: 't' });
  t.innerHTML = '<thead><tr><th scope="col">Parâmetro</th><th scope="col">Valor</th><th scope="col">Faixa</th></tr></thead>';
  const body = el('tbody');
  for (const prm of shown.params) {
    const inp = el('input', { type: 'number', value: String(prm.value), step: 'any', disabled: !editable, cls: 'val' + (prm.value < prm.min || prm.value > prm.max ? ' bad' : '') });
    inp.setAttribute('aria-label', `${prm.name} (${prm.unit})`);
    inp.dataset.key = prm.key;
    inp.addEventListener('change', () => {
      const val = Number(inp.value);
      if (!Number.isFinite(val)) return;
      const before = r.versions.length;
      const ver = editParam(r, prm.key, val, WHO[role], today());
      if (r.versions.length > before) log(`Receita ${stepName(r.step)}: aberta a v${ver.v} (rascunho)`);
      versionSel = null;
      save(); render();
    });
    body.appendChild(el('tr', {}, el('td', { textContent: `${prm.name} (${prm.unit})` }), el('td', {}, inp), el('td', { cls: 'num', textContent: `${prm.min} a ${prm.max}` })));
  }
  t.appendChild(body);
  box.appendChild(t);
  // difference to the version in use (or the previous one)
  const base = shown === used ? r.versions[r.versions.indexOf(shown) - 1] : used;
  if (base && base !== shown) {
    const d = diff(base, shown);
    const div = el('div', { cls: 'diff' }, el('b', { textContent: `Diferença para a v${base.v}: ` }));
    if (!d.length) div.append('nenhuma.');
    d.forEach((x, i) => div.append(i ? ' · ' : '', `${x.name} `, el('span', { cls: 'from', textContent: String(x.from) }), ' → ', el('span', { cls: 'to', textContent: `${x.to} ${x.unit}` })));
    box.appendChild(div);
  }
  // actions by role
  const bad = outOfRange(shown);
  const act = el('div', { cls: 'actions' });
  if (shown === cur && cur.status === 'rascunho') {
    const b = el('button', { type: 'button', cls: 'btn', textContent: 'Enviar para aprovação', disabled: role !== 'eng' || bad.length > 0 });
    b.onclick = () => { cur.status = 'em-aprovacao'; log(`Receita ${stepName(r.step)} v${cur.v} enviada para aprovação`); save(); render(); toast('Enviada para a Qualidade.'); };
    act.appendChild(b);
    act.appendChild(el('span', { cls: 'why', textContent: bad.length ? `Fora da faixa: ${bad.map(x => x.name).join(', ')}.` : role !== 'eng' ? 'Só a Engenharia envia receitas.' : '' }));
  } else if (shown === cur && cur.status === 'em-aprovacao') {
    const ok = el('button', { type: 'button', cls: 'btn ok', textContent: 'Aprovar', disabled: role !== 'qual' });
    ok.onclick = () => { cur.status = 'aprovado'; cur.approvedBy = WHO.qual; log(`Receita ${stepName(r.step)} v${cur.v} aprovada`); save(); render(); toast(`v${cur.v} aprovada: passa a ser a versão das máquinas.`); };
    const back = el('button', { type: 'button', cls: 'btn', textContent: 'Devolver', disabled: role !== 'qual' });
    back.onclick = () => { cur.status = 'rascunho'; log(`Receita ${stepName(r.step)} v${cur.v} devolvida para ajuste`); save(); render(); };
    act.append(ok, back, el('span', { cls: 'why', textContent: role !== 'qual' ? 'Troque o perfil para Qualidade para aprovar.' : '' }));
  } else if (editable) act.appendChild(el('span', { cls: 'why', textContent: 'Altere um valor para abrir uma nova versão em rascunho. A versão aprovada continua nas máquinas até a nova ser aprovada.' }));
  box.appendChild(act);
  v.appendChild(el('div', { cls: 'recipes' }, list, box));
}

function renderInstructions() {
  const p = P(), v = $('v-instrucoes');
  v.textContent = '';
  const grid = el('div', { cls: 'instr' });
  for (const ins of p.instructions) {
    const a = el('article', {}, el('h4', { textContent: ins.title }), el('p', { cls: 'hint', textContent: `${stepName(ins.step)} · rev. ${ins.rev}` }), tag(ins.status));
    const ul = el('ul');
    ins.checks.forEach(c => ul.appendChild(el('li', { textContent: c })));
    a.appendChild(ul);
    if (ins.status !== 'aprovado') {
      const b = el('button', { type: 'button', cls: 'btn ok', textContent: 'Aprovar instrução', disabled: role !== 'qual' || p.released });
      b.onclick = () => { ins.status = 'aprovado'; log(`Instrução "${ins.title}" rev. ${ins.rev} aprovada`); save(); render(); };
      a.appendChild(b);
      if (role !== 'qual') a.appendChild(el('span', { cls: 'why', textContent: 'A Qualidade aprova as instruções.' }));
    }
    grid.appendChild(a);
  }
  v.append(grid, el('p', { cls: 'hint', textContent: 'Na estação, o operador vê só a revisão aprovada da instrução da operação, junto com a receita em uso.' }));
}

function renderPilot() {
  const p = P(), v = $('v-piloto'), pl = p.pilot;
  v.textContent = '';
  const kp = (b: string, s: string) => el('div', { cls: 'kpi' }, el('b', { textContent: b }), el('span', { textContent: s }));
  v.appendChild(el('div', { cls: 'pilot' },
    kp(pl.lot, `Lote piloto · ${pl.wafers} wafers`),
    kp(pl.yield == null ? '—' : `${(pl.yield * 100).toFixed(1).replace('.', ',')}%`, `Rendimento (meta ${(pl.yieldTarget * 100).toFixed(0)}%)`),
  ));
  const ul = el('ul', { cls: 'checks' });
  pl.checks.forEach(c => {
    const cb = el('input', { type: 'checkbox', checked: c.done, disabled: role !== 'prod' || p.released });
    cb.onchange = () => { c.done = cb.checked; log(`Lote piloto: "${c.name}" ${c.done ? 'concluído' : 'reaberto'}`); save(); render(); };
    ul.appendChild(el('li', {}, el('label', {}, cb, c.name)));
  });
  v.append(el('h3', { textContent: 'Checklist do lote piloto' }), ul);
  if (pl.yield == null) {
    const b = el('button', { type: 'button', cls: 'btn', textContent: 'Registrar rendimento do piloto', disabled: role !== 'prod' || p.released });
    b.onclick = () => { pl.yield = 0.961; log('Rendimento do lote piloto registrado: 96,1%'); save(); render(); };
    v.appendChild(el('div', { cls: 'actions' }, b, el('span', { cls: 'why', textContent: role !== 'prod' ? 'A Produção registra o lote piloto.' : 'Exemplo: traz o rendimento medido no MES.' })));
  } else if (role !== 'prod') v.appendChild(el('p', { cls: 'hint', textContent: 'A Produção marca o checklist do lote piloto.' }));
}

function renderHistory() {
  const v = $('v-historico');
  v.textContent = '';
  const ol = el('ol', { cls: 'timeline' });
  [...P().history].reverse().forEach(h => ol.appendChild(el('li', {}, el('span', { textContent: h.what }), el('br'), el('small', { textContent: `${fmtDate(h.date)} · ${h.who}` }))));
  v.appendChild(ol);
}

function renderRelease() {
  const p = P(), box = $('release');
  box.textContent = '';
  if (p.released) { box.appendChild(el('p', { cls: 'released', textContent: 'Liberado no MES. As máquinas usam só as versões aprovadas desta rota.' })); return; }
  const bl = blockers(p);
  if (bl.length) {
    box.appendChild(el('p', { cls: 'hint', textContent: `Falta ${bl.length} ${bl.length === 1 ? 'item' : 'itens'} para liberar:` }));
    const ul = el('ul', { cls: 'blockers' });
    bl.forEach(b => ul.appendChild(el('li', { textContent: b })));
    box.appendChild(ul);
  } else box.appendChild(el('p', { cls: 'ready', textContent: 'Tudo aprovado. Pronto para liberar.' }));
  const b = el('button', { type: 'button', cls: 'btn accent', textContent: 'Liberar no MES', disabled: bl.length > 0 || role !== 'qual' });
  b.id = 'b-release';
  b.onclick = () => { p.released = true; log('Liberado no MES'); save(); render(); toast('Produto liberado no MES.'); };
  box.appendChild(el('div', { cls: 'actions' }, b, el('span', { cls: 'why', textContent: role !== 'qual' && !bl.length ? 'A Qualidade libera.' : '' })));
}

function renderCompare() {
  const body = $('cmp').querySelector('tbody')!;
  body.textContent = '';
  COMPARE.forEach(c => body.appendChild(el('tr', {}, el('td', { textContent: c.name }), el('td', { textContent: c.today }), el('td', { textContent: c.platform }))));
}

function render() {
  renderProducts(); renderHead(); renderRoute(); renderRecipes(); renderInstructions(); renderPilot(); renderHistory(); renderRelease();
}

// ---------- tabs, role, reset ----------
const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tabs [role=tab]')];
tabs.forEach(t => t.addEventListener('click', () => tabs.forEach(o => {
  o.setAttribute('aria-selected', String(o === t));
  $(o.getAttribute('aria-controls')!).hidden = o !== t;
})));
const roleSel = $<HTMLSelectElement>('role');
roleSel.addEventListener('change', () => { role = roleSel.value as Role; render(); });
$('reset').onclick = () => { products = sampleProducts(); sel = 0; recipeSel = 0; versionSel = null; save(); render(); toast('Dados de exemplo restaurados.'); };

renderCompare();
render();

declare global { interface Window { __a04: unknown } }
window.__a04 = { get products() { return products; }, recipe: (): Recipe => P().recipes[recipeSel] };

/** Portal cover (tests/e2e/capa.spec.ts): the product still at the recipes stage, on the recipes tab. */
(window as unknown as { __capa: () => void }).__capa = () => {
  sel = 2; recipeSel = products[2].recipes.findIndex(r => current(r).status !== 'aprovado'); versionSel = null;
  render();
  document.getElementById('t-receitas')!.click();
};
