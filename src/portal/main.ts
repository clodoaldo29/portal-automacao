// Portfolio portal: one card per client (/clientes.json); a client's card opens its projects (/projetos.json).
import './portal.css';

interface Project {
  id: string;
  client: string;
  name: string;
  status: StatusId;
  description?: string;
  metrics?: Partial<Record<MetricKey, string>>;
  /** Replaces a metric's default label (for projects where "UPH" or "Estações" do not fit). */
  metricLabels?: Partial<Record<MetricKey, string>>;
  cover?: string;
  url?: string;
  updatedAt?: string;
}
type StatusId = 'estudo' | 'validacao' | 'aprovado' | 'implantacao' | 'pausado';
type MetricKey = 'uph' | 'robots' | 'models' | 'stations';

const STATUS: { id: StatusId; label: string }[] = [
  { id: 'estudo', label: 'Em estudo' }, { id: 'validacao', label: 'Em validação' }, { id: 'aprovado', label: 'Aprovado' },
  { id: 'implantacao', label: 'Em implantação' }, { id: 'pausado', label: 'Pausado' },
];
const METRICS: [MetricKey, string][] = [['uph', 'UPH'], ['robots', 'Robôs'], ['models', 'Produtos'], ['stations', 'Estações']];
const statusOf = (id: string) => STATUS.find(s => s.id === id) || STATUS[0];

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string | null | undefined | (Node | string)[])[]) {
  const n = document.createElement(tag);
  Object.assign(n, props);
  kids.flat().forEach(k => { if (k != null) n.append(k); });
  return n;
}
const initials = (s: string) => (s || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
const fmtDate = (d: string) => { try { return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return ''; } };
/** Links: same-site paths or https only. */
const safeUrl = (u?: string) => (/^https:\/\//i.test(u || '') || /^[a-z0-9][a-z0-9\-_/.]*$/i.test(u || '') ? u! : '');

/** Client from /clientes.json; a project's `client` is the client's `name`. */
interface Client { id: string; name: string; initials?: string; color?: string; logo?: string; description?: string }

let projects: Project[] = [];
let clients: Client[] = [];
let statusFilter = '';
/** Client being shown ('' = the client cards); kept in the address as ?cliente=<id>. */
let current = '';
const expanded = new Set<string>();

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const safeColor = (c?: string) => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c! : '');
/**
 * Clients in the order their first project appears in projetos.json, with the data of clientes.json when there is any;
 * then the clients of clientes.json with no project yet, in that file's order.
 */
function clientsOf(list: Project[], known: Client[]) {
  const out: Client[] = [];
  list.forEach(p => {
    if (!p.client || out.some(c => c.name === p.client)) return;
    out.push(known.find(c => c.name === p.client) || { id: slug(p.client), name: p.client });
  });
  known.forEach(c => { if (c && c.id && c.name && !out.some(o => o.name === c.name)) out.push(c); });
  return out;
}
const projectsOf = (c: Client) => projects.filter(p => p.client === c.name);
const clientById = (id: string) => clients.find(c => c.id === id);
const lastUpdate = (list: Project[]) => list.map(p => p.updatedAt || '').sort().pop() || '';

function badge(c: Client, cls: string) {
  const b = el('div', { className: cls });
  const color = safeColor(c.color);
  if (color) b.style.setProperty('--cl', color);
  const logo = safeUrl(c.logo);
  if (logo) b.classList.add('has-img');
  b.append(logo ? el('img', { src: logo, alt: c.name }) : el('span', { textContent: c.initials || initials(c.name) }));
  return b;
}

function renderTotals() {
  const n = (id: StatusId) => projects.filter(p => p.status === id).length;
  const vals = [projects.length, clients.length, n('estudo') + n('validacao') + n('implantacao'), n('aprovado')];
  const box = $('totals');
  box.textContent = '';
  ['projetos', 'clientes', 'em andamento', 'aprovados'].forEach((l, i) => box.append(el('div', {}, el('b', { textContent: String(vals[i]) }), el('span', { textContent: l }))));
}

function renderFilters() {
  const chips = $('chips');
  chips.textContent = '';
  const cl = clientById(current);
  chips.hidden = !cl;
  if (!cl) return;
  const own = projectsOf(cl);
  const mk = (id: string, label: string, count: number, color?: string) => {
    const dot = color ? el('span', { className: 'dot' }) : null;
    if (dot) dot.style.color = `var(${color})`;
    const b = el('button', { type: 'button', className: 'chip' }, dot, label, el('i', { textContent: String(count) }));
    b.setAttribute('aria-pressed', String(statusFilter === id));
    b.onclick = () => { statusFilter = statusFilter === id ? '' : id; renderFilters(); renderGrid(); };
    return b;
  };
  chips.append(mk('', 'Todos', own.length));
  STATUS.forEach(s => { const c = own.filter(p => p.status === s.id).length; if (c) chips.append(mk(s.id, s.label, c, `--st-${s.id}`)); });
}

function renderCrumb() {
  const nav = $('crumb'), cl = clientById(current);
  nav.textContent = '';
  nav.hidden = !cl;
  $<HTMLInputElement>('q').placeholder = cl ? `Buscar nos projetos de ${cl.name}` : 'Buscar projeto em todos os clientes';
  if (!cl) return;
  const back = el('a', { className: 'back', href: './', textContent: '← Todos os clientes' });
  back.onclick = e => { if (plainClick(e)) { e.preventDefault(); go(''); } };
  const n = projectsOf(cl).length;
  nav.append(back, el('div', { className: 'who' }, badge(cl, 'logo sm'), el('div', {},
    el('h2', { textContent: cl.name }), el('span', { textContent: `${n} ${n === 1 ? 'projeto' : 'projetos'}` }))));
}

const plainClick = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

function clientCard(c: Client) {
  const own = projectsOf(c), href = `?cliente=${encodeURIComponent(c.id)}`;
  const a = el('a', { className: 'client-card', href });
  a.setAttribute('aria-label', `Ver projetos de ${c.name}`);
  const color = safeColor(c.color);
  if (color) a.style.setProperty('--cl', color);
  a.onclick = e => { if (plainClick(e)) { e.preventDefault(); go(c.id); } };
  const head = el('div', { className: 'client-head' }, badge(c, 'logo'));
  a.append(head);
  const b = el('div', { className: 'body' });
  b.append(el('h2', { textContent: c.name }));
  if (c.description) b.append(el('p', { className: 'desc', textContent: c.description }));
  const counts = STATUS.map(s => [s, own.filter(p => p.status === s.id).length] as const).filter(([, n]) => n);
  b.append(el('div', { className: 'mix' }, counts.map(([s, n]) => {
    const d = el('span', { className: 'dot' });
    d.style.color = `var(--st-${s.id})`;
    return el('span', {}, d, `${n} ${s.label.toLowerCase()}`);
  })));
  if (!own.length) b.append(el('div', { className: 'mix' }, 'Nenhum projeto publicado ainda'));
  b.append(el('span', { className: 'open-sim' + (own.length ? '' : ' soon'), textContent: own.length ? `Ver ${own.length} ${own.length === 1 ? 'projeto' : 'projetos'}` : 'Abrir área do cliente' }));
  const last = lastUpdate(own);
  if (last) b.append(el('div', { className: 'foot', textContent: `Atualizado em ${fmtDate(last)}` }));
  a.append(b);
  return a;
}

/** Opens a client (or the client cards with ''), in the address too so the link can be shared and "back" works. */
function go(id: string, push = true) {
  current = clientById(id) ? id : '';
  statusFilter = '';
  $<HTMLInputElement>('q').value = '';
  if (push) history.pushState(null, '', current ? `?cliente=${encodeURIComponent(current)}` : location.pathname);
  render();
  window.scrollTo(0, 0);
}
const fromAddress = () => new URLSearchParams(location.search).get('cliente') || '';

function render() { renderCrumb(); renderFilters(); renderGrid(); }

function card(p: Project) {
  const st = statusOf(p.status), url = safeUrl(p.url);
  const c = el('article', { className: `card s-${st.id}` }, el('div', { className: 'stripe' }));
  const cov = url ? el('a', { className: 'cover', href: url }) : el('div', { className: 'cover' });
  if (url) cov.setAttribute('aria-label', `Abrir simulação ${p.name}`);
  cov.append(p.cover ? el('img', { src: p.cover, alt: '', loading: 'lazy' }) : el('div', { className: 'ph', textContent: initials(p.name) }));
  cov.append(el('span', { className: 'status', textContent: st.label }));
  c.append(cov);
  const b = el('div', { className: 'body' });
  b.append(el('div', {}, el('div', { className: 'client', textContent: p.client || '' }), el('h2', { textContent: p.name })));
  if (p.description) {
    b.append(el('p', { className: 'desc' + (expanded.has(p.id) ? ' open' : ''), textContent: p.description }));
    if (p.description.length > 140) {
      const more = el('button', { type: 'button', className: 'more', textContent: expanded.has(p.id) ? 'Mostrar menos' : 'Ler descrição completa' });
      more.onclick = () => { if (expanded.has(p.id)) expanded.delete(p.id); else expanded.add(p.id); renderGrid(); };
      b.append(more);
    }
  }
  const m = p.metrics || {};
  if (METRICS.some(([k]) => m[k])) b.append(el('div', { className: 'metrics' }, METRICS.map(([k, l]) => el('div', { className: 'metric' }, el('span', { textContent: p.metricLabels?.[k] || l }), el('b', { textContent: m[k] || '—' })))));
  if (url) b.append(el('a', { className: 'open-sim', href: url, textContent: 'Abrir simulação 3D' }));
  if (p.updatedAt) b.append(el('div', { className: 'foot', textContent: `Atualizado em ${fmtDate(p.updatedAt)}` }));
  c.append(b);
  return c;
}

function renderGrid() {
  const grid = $('grid');
  grid.textContent = '';
  const q = $<HTMLInputElement>('q').value.trim().toLowerCase(), cl = clientById(current);
  grid.classList.toggle('clients', !cl && !q);
  // the client cards: no client open and nothing typed in the search (the search looks in every client's projects)
  if (!cl && !q) {
    if (!clients.length) grid.append(el('div', { className: 'state' }, el('h2', { textContent: 'Nenhum projeto publicado ainda' })));
    clients.forEach(c => grid.append(clientCard(c)));
    return;
  }
  // cards keep the order of projetos.json (the order the projects were added): a new project goes to the end
  const list = projects
    .filter(p => !cl || p.client === cl.name)
    .filter(p => !cl || !statusFilter || p.status === statusFilter)
    .filter(p => !q || [p.client, p.name, p.description, ...Object.values(p.metrics || {})].join(' ').toLowerCase().includes(q));
  if (!list.length) {
    const empty = cl && !projectsOf(cl).length;
    grid.append(el('div', { className: 'state' }, el('h2', { textContent: empty ? `Nenhum projeto de ${cl.name} publicado ainda` : 'Nenhum projeto com esses filtros' }),
      empty ? el('p', { textContent: 'Os projetos aparecem aqui assim que forem cadastrados.' }) : null));
    return;
  }
  list.forEach(p => grid.append(card(p)));
}

$('q').addEventListener('input', renderGrid);
window.addEventListener('popstate', () => go(fromAddress(), false));

const getJSON = (file: string) => fetch(`${import.meta.env.BASE_URL}${file}`, { cache: 'no-cache' })
  .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); });
Promise.all([getJSON('projetos.json'), getJSON('clientes.json').catch(() => [])])
  .then(([data, known]: unknown[]) => {
    projects = Array.isArray(data) ? (data as Project[]) : [];
    clients = clientsOf(projects, Array.isArray(known) ? (known as Client[]) : []);
    renderTotals();
    current = clientById(fromAddress()) ? fromAddress() : '';
    if (!current && fromAddress()) history.replaceState(null, '', location.pathname);
    render();
  })
  .catch(() => {
    const grid = $('grid');
    grid.textContent = '';
    grid.append(el('div', { className: 'state' }, el('h2', { textContent: 'Não foi possível carregar os projetos' }), el('p', { textContent: 'Recarregue a página em alguns instantes.' })));
  });
