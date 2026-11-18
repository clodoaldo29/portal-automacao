// "Projetos Adata" menu in the dock (<details id="m-proj"> with <ul id="proj-links">): a shortcut to every project
// of the portfolio, inside the plant when it has a cell there. Used by the plant page and by every project page
// inside the plant, so the menu stays available while a project is open; the current one is marked.
import { PLANT_PROJECTS } from './projects-layer';

export function mountProjectsMenu() {
  const ul = document.getElementById('proj-links'), menu = document.getElementById('m-proj') as HTMLDetailsElement | null;
  if (!ul || !menu) return;
  const here = location.pathname.replace(/index\.html$/, '');
  for (const p of PLANT_PROJECTS) {
    const href = p.plant ?? p.url;
    const a = document.createElement('a'), b = document.createElement('b'), s = document.createElement('span'), sm = document.createElement('small');
    a.href = href;
    b.textContent = p.num;
    b.style.background = p.color;
    s.textContent = p.name;
    sm.textContent = p.note;
    a.append(b, s, sm);
    if (href === here) a.setAttribute('aria-current', 'page');
    const li = document.createElement('li');
    li.appendChild(a);
    ul.appendChild(li);
  }
  // close when clicking elsewhere or pressing Escape
  document.addEventListener('click', e => { if (menu.open && !menu.contains(e.target as Node)) menu.open = false; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') menu.open = false; });
}
