// The menu overlays: title (mission select), briefing, results and pause. Fills
// them from missions.js data and wires their buttons to the handlers main gives.

import { MISSIONS, RUNWAYS } from './config.js';
import { briefingFor, loadBestScores } from './missions.js';

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** handlers: { select(i), brief(), start(), title(), retry(), next(), resume() } */
export function createScreens(handlers) {
  const screens = { title: $('screen-title'), briefing: $('screen-briefing'), results: $('screen-results'), pause: $('screen-pause') };
  const list = $('mission-list');
  const buttons = MISSIONS.map((m, i) => {
    const b = el('button', 'mission');
    const name = el('span', 'mission-name', m.name);
    const land = RUNWAYS.find((r) => r.id === m.landRunway);
    name.append(el('span', 'mission-goal', `${m.rings.length} rings · land at ${land.name}`));
    b.append(el('span', 'mission-num', String(i + 1)), name, el('span', 'mission-best', ''));
    b.addEventListener('click', () => {
      handlers.select(i);
      handlers.brief();
    });
    list.append(b);
    return b;
  });

  const wire = (id, fn) => $(id).addEventListener('click', fn);
  wire('brief-start', () => handlers.start());
  wire('brief-back', () => handlers.title());
  wire('res-menu', () => handlers.title());
  wire('res-retry', () => handlers.retry());
  wire('res-next', () => handlers.next());
  wire('pause-resume', () => handlers.resume());
  wire('pause-restart', () => handlers.retry());
  wire('pause-menu', () => handlers.title());

  return {
    /** Shows one overlay by name ('title', 'briefing', 'results', 'pause') or none (null). */
    show(name) {
      for (const [key, node] of Object.entries(screens)) node.classList.toggle('hidden', key !== name);
    },
    renderTitle(selected) {
      const best = loadBestScores();
      buttons.forEach((b, i) => {
        b.classList.toggle('selected', i === selected);
        const record = best[MISSIONS[i].id];
        b.lastChild.textContent = record ? `BEST ${record.total} · ${record.rank}` : '';
      });
    },
    renderBriefing(index, world) {
      const data = briefingFor(index, world);
      $('brief-kicker').textContent = data.kicker;
      $('brief-title').textContent = data.title;
      $('brief-text').textContent = data.text;
      $('brief-goals').replaceChildren(...data.goals.map((g) => el('li', '', g)));
    },
    renderResults(r) {
      $('res-kicker').textContent = r.kicker;
      $('res-title').textContent = r.title;
      $('res-reason').textContent = r.reason;
      const rows = r.rows.map((row) => {
        const tr = el('tr');
        const pts = el('td', row.points < 0 ? 'neg' : '', `${row.points > 0 ? '+' : ''}${row.points}`);
        tr.append(el('td', '', row.label), el('td', '', row.detail), pts);
        return tr;
      });
      const total = el('tr', 'total');
      total.append(el('td', '', 'Total'), el('td', '', ''), el('td', '', String(r.total)));
      $('res-table').replaceChildren(...rows, total);
      $('res-rank').textContent = r.rank;
      $('res-next').classList.toggle('hidden', !(r.success && r.hasNext));
    },
  };
}
