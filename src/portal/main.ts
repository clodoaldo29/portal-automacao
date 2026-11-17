// Portfolio portal: one card per project, read from /projetos.json.
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

let projects: Project[] = [];
let statusFilter = '';
const expanded = new Set<string>();

function renderTotals() {
  const n = (id: StatusId) => projects.filter(p => p.status === id).length;
  const vals = [projects.length, new Set(projects.map(p => p.client)).size, n('estudo') + n('validacao') + n('implantacao'), n('aprovado')];
  const box = $('totals');
  box.textContent = '';
  ['projetos', 'clientes', 'em andamento', 'aprovados'].forEach((l, i) => box.append(el('div', {}, el('b', { textContent: String(vals[i]) }), el('span', { textContent: l }))));
}

function renderFilters() {
  const chips = $('chips');
  chips.textContent = '';
  const mk = (id: string, label: string, count: number, color?: string) => {
    const dot = color ? el('span', { className: 'dot' }) : null;
    if (dot) dot.style.color = `var(${color})`;
    const b = el('button', { type: 'button', className: 'chip' }, dot, label, el('i', { textContent: String(count) }));
    b.setAttribute('aria-pressed', String(statusFilter === id));
    b.onclick = () => { statusFilter = statusFilter === id ? '' : id; renderFilters(); renderGrid(); };
    return b;
  };
  chips.append(mk('', 'Todos', projects.length));
  STATUS.forEach(s => { const c = projects.filter(p => p.status === s.id).length; if (c) chips.append(mk(s.id, s.label, c, `--st-${s.id}`)); });
}

function fillClients() {
  const sel = $<HTMLSelectElement>('f-client');
  [...new Set(projects.map(p => p.client).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')).forEach(c => sel.append(el('option', { value: c, textContent: c })));
}

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
  const q = $<HTMLInputElement>('q').value.trim().toLowerCase(), cl = $<HTMLSelectElement>('f-client').value;
  const list = projects
    .filter(p => !statusFilter || p.status === statusFilter)
    .filter(p => !cl || p.client === cl)
    .filter(p => !q || [p.client, p.name, p.description, ...Object.values(p.metrics || {})].join(' ').toLowerCase().includes(q))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  if (!list.length) {
    grid.append(el('div', { className: 'state' }, el('h2', { textContent: projects.length ? 'Nenhum projeto com esses filtros' : 'Nenhum projeto publicado ainda' })));
    return;
  }
  list.forEach(p => grid.append(card(p)));
}

$('q').addEventListener('input', renderGrid);
$('f-client').addEventListener('change', renderGrid);

fetch(`${import.meta.env.BASE_URL}projetos.json`, { cache: 'no-cache' })
  .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
  .then((data: unknown) => {
    projects = Array.isArray(data) ? (data as Project[]) : [];
    renderTotals(); renderFilters(); fillClients(); renderGrid();
  })
  .catch(() => {
    const grid = $('grid');
    grid.textContent = '';
    grid.append(el('div', { className: 'state' }, el('h2', { textContent: 'Não foi possível carregar os projetos' }), el('p', { textContent: 'Recarregue a página em alguns instantes.' })));
  });
