/**
 * Top-centre notification banner (poster: "Location discovered: Lookout" +
 * "+250 XP"; Dutch "Locatie ontdekt: Uitkijkpost"). One message at a time from a queue: discoveries, quest start /
 * completion, level-ups. Lives in the top-center HUD slot below the compass
 * strip and the world-event banner.
 */
import '../css/hud.css';

export function createNotifier(ctx) {
  const { ui } = ctx;
  const icon = ui.h('span', { class: 'sys-notice-icon' });
  const title = ui.h('span', { class: 'sys-notice-title' });
  const sub = ui.h('div', { class: 'sys-notice-sub' });
  const el = ui.h(
    'div',
    { class: 'sys-notice', 'aria-live': 'polite' },
    ui.h(
      'div',
      { class: 'sys-notice-row' },
      ui.h('i', { class: 'sys-notice-line l' }),
      ui.h('div', { class: 'sys-notice-pill' }, icon, title),
      ui.h('i', { class: 'sys-notice-line r' }),
    ),
    sub,
  );
  ui.addWidget('top-center', el, { modes: ['explore', 'drive', 'space'], order: 30 });

  const queue = [];
  let busy = false;
  let timer = null;

  function show(n) {
    if (!n?.title) return;
    // drop exact duplicates that are already waiting
    if (queue.some((q) => q.title === n.title && q.sub === n.sub)) return;
    queue.push(n);
    if (!busy) next();
  }

  function next() {
    timer = null;
    if (!queue.length) {
      busy = false;
      return;
    }
    busy = true;
    // Wait while the widget is hidden (title screen, mode transition).
    if (el.hidden || ctx.modes?.transitioning) {
      timer = setTimeout(next, 300);
      return;
    }
    const n = queue.shift();
    el.dataset.kind = n.kind || 'info';
    icon.innerHTML = ui.icon(n.icon || 'sys-hex', 22);
    title.textContent = n.title;
    sub.textContent = n.sub || '';
    sub.hidden = !n.sub;
    el.classList.remove('show');
    void el.offsetWidth; // restart the CSS transition
    el.classList.add('show');
    if (n.sound !== false) ctx.audio.play(n.sound || 'toast');
    // a backlog (signal found: discovery + quest done + new quest + lore) moves along faster
    const dur = (n.duration || 3800) * (queue.length >= 2 ? 0.7 : 1);
    timer = setTimeout(() => {
      el.classList.remove('show');
      timer = setTimeout(next, 520);
    }, dur);
  }

  function clear() {
    queue.length = 0;
    clearTimeout(timer);
    el.classList.remove('show');
    busy = false;
  }

  return { show, clear, el, get busy() { return busy; } };
}
