/**
 * Ø Studio dialogs: start screen (templates + drafts), experience settings, publish.
 *   const dialogs = createDialogs(ctx, ed, { store, studio });
 *   dialogs.openStart({ canClose }) · dialogs.openSettings() · dialogs.openPublish()
 */
import { t, lang } from '../core/i18n.js';
import { icon } from '../ui/icons.js';
import { PALETTE, MATERIALS, SKIES, SKY_TIME, LIMITS, filterText } from './format.js';
import { MATERIAL_NAMES } from './panels.js';

const T = {
  studio: { en: 'Ø Studio', nl: 'Ø Studio' },
  tagline: { en: 'Create · Play · Share', nl: 'Maak · Speel · Deel' },
  newExp: { en: 'New experience', nl: 'Nieuwe ervaring' },
  drafts: { en: 'Your drafts', nl: 'Jouw concepten' },
  cloud: { en: 'In your account', nl: 'In je account' },
  loading: { en: 'Loading…', nl: 'Laden…' },
  noDrafts: { en: 'No drafts yet — pick a template above to start building.', nl: 'Nog geen concepten — kies hierboven een sjabloon om te beginnen.' },
  tpl: {
    baseplate: { name: { en: 'Baseplate', nl: 'Bouwplaat' }, text: { en: 'A clean 512 m plate at golden hour.', nl: 'Een lege plaat van 512 m in het gouden uur.' } },
    obby: { name: { en: 'Obby', nl: 'Obby' }, text: { en: 'A ready neon parkour course to remix.', nl: 'Een kant-en-klaar neon-parcours om te remixen.' } },
    empty: { name: { en: 'Empty space', nl: 'Lege ruimte' }, text: { en: 'No ground, just stars — build in the void.', nl: 'Geen grond, alleen sterren — bouw in het niets.' } },
  },
  back: { en: 'Back', nl: 'Terug' },
  del: { en: 'Delete draft', nl: 'Concept verwijderen' },
  sure: { en: 'Click again to delete', nl: 'Klik nogmaals om te verwijderen' },
  published: { en: 'Published', nl: 'Gepubliceerd' },
  edited: { en: 'Edited {ago}', nl: 'Bewerkt {ago}' },
  parts: { en: '{n} parts', nl: '{n} onderdelen' },
  settings: { en: 'Settings', nl: 'Instellingen' },
  settingsSub: { en: 'World · sky · rules', nl: 'Wereld · lucht · regels' },
  title: { en: 'Title', nl: 'Titel' },
  description: { en: 'Description', nl: 'Beschrijving' },
  sky: { en: 'Sky', nl: 'Lucht' },
  skies: { golden: { en: 'Golden', nl: 'Goud' }, day: { en: 'Day', nl: 'Dag' }, night: { en: 'Night', nl: 'Nacht' }, space: { en: 'Space', nl: 'Ruimte' } },
  time: { en: 'Time of day', nl: 'Tijdstip' },
  gravity: { en: 'Gravity', nl: 'Zwaartekracht' },
  baseplate: { en: 'Baseplate', nl: 'Bouwplaat' },
  bpColor: { en: 'Plate colour', nl: 'Plaatkleur' },
  bpMat: { en: 'Plate material', nl: 'Plaatmateriaal' },
  none: { en: 'None', nl: 'Geen' },
  maxPlayers: { en: 'Max players', nl: 'Max. spelers' },
  done: { en: 'Done', nl: 'Klaar' },
  publish: { en: 'Publish', nl: 'Publiceren' },
  publishSub: { en: 'Share your experience', nl: 'Deel je ervaring' },
  retake: { en: 'Retake', nl: 'Opnieuw' },
  cancel: { en: 'Cancel', nl: 'Annuleren' },
  publishing: { en: 'Publishing…', nl: 'Publiceren…' },
  signedIn: { en: 'Signed in as <b>{name}</b> — your experience appears on Home for everyone (single-player in v1).', nl: 'Ingelogd als <b>{name}</b> — je ervaring verschijnt op Home voor iedereen (in v1 voor één speler).' },
  local: { en: 'You are not signed in — this publishes on <b>this device</b> only. Sign in to share it with everyone.', nl: 'Je bent niet ingelogd — dit publiceert alleen op <b>dit apparaat</b>. Log in om het met iedereen te delen.' },
  signIn: { en: 'Sign in', nl: 'Inloggen' },
  noSpawn: { en: 'Add a Spawn part first — players start there.', nl: 'Voeg eerst een startpunt toe — spelers beginnen daar.' },
  noTitle: { en: 'Give your experience a title.', nl: 'Geef je ervaring een titel.' },
  doneTitle: { en: 'Published', nl: 'Gepubliceerd' },
  doneCloud: { en: '“{title}” is live on Ø Universe. Friends can find it on Home.', nl: '“{title}” staat live op Ø Universe. Vrienden vinden het op Home.' },
  doneLocal: { en: '“{title}” is published on this device. Sign in to share it with everyone.', nl: '“{title}” is gepubliceerd op dit apparaat. Log in om het met iedereen te delen.' },
  playNow: { en: 'Play now', nl: 'Nu spelen' },
  failed: { en: 'Publishing failed: {msg}', nl: 'Publiceren mislukt: {msg}' },
  untitled: { en: 'My experience', nl: 'Mijn ervaring' },
};

function ago(ts) {
  const s = Math.max(0, (Date.now() - (ts || 0)) / 1000);
  const nl = lang() === 'nl';
  if (s < 60) return nl ? 'zojuist' : 'just now';
  if (s < 3600) return nl ? `${Math.round(s / 60)} min geleden` : `${Math.round(s / 60)} min ago`;
  if (s < 86400) return nl ? `${Math.round(s / 3600)} u geleden` : `${Math.round(s / 3600)} h ago`;
  try {
    return new Date(ts).toLocaleDateString(nl ? 'nl-NL' : 'en-US', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}
const hhmm = (h) => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;

export function createDialogs(ctx, ed, { store, studio }) {
  const { ui } = ctx;
  const h = ui.h;
  const head = (title, sub, onClose) =>
    h(
      'div',
      { class: 'modal-head' },
      h('div', {}, h('h2', { text: t(title) }), sub ? h('p', { text: t(sub) }) : null),
      onClose ? h('button', { class: 'modal-close', type: 'button', 'aria-label': t({ en: 'Close', nl: 'Sluiten' }), html: icon('close', 20), onclick: onClose }) : null,
    );
  const sec = (title, right = null) => h('div', { class: 'studio-group-title', style: { margin: '18px 0 10px' } }, h('span', { text: t(title) }), right);

  // ------------------------------------------------------------ start screen
  function openStart({ canClose = false } = {}) {
    const close = () => ui.closeModal('studio-start');
    const tplCard = (id) =>
      h(
        'button',
        { type: 'button', class: 'studio-tpl', onclick: () => {
          close();
          studio.newDraft(id);
        } },
        h('div', { class: 'studio-tpl-art', dataset: { t: id } }),
        h('div', { class: 'studio-tpl-body' }, h('b', { text: t(T.tpl[id].name) }), h('span', { text: t(T.tpl[id].text) })),
      );
    const list = store.list();
    const recent = h('div', { class: 'studio-recent' });
    if (!list.length) recent.appendChild(h('div', { class: 'studio-empty', style: { gridColumn: '1 / -1', textAlign: 'left', padding: '4px 0' }, text: t(T.noDrafts) }));
    for (const e of list.slice(0, 24)) {
      const thumb = store.thumb(e.id);
      let armed = 0;
      const del = h('button', { class: 'studio-card-del', type: 'button', title: t(T.del), html: icon('trash', 15) });
      del.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (Date.now() - armed > 2500) {
          armed = Date.now();
          del.title = t(T.sure);
          del.style.color = 'var(--red)';
          ui.toast({ title: t(T.sure), kind: 'warn', duration: 1800 });
          return;
        }
        store.remove(e.id);
        card.remove();
      });
      const card = h(
        'div',
        { class: 'studio-card', onclick: () => {
          close();
          studio.openDraft(e.id);
        } },
        h('div', { class: 'studio-card-img', style: thumb ? { backgroundImage: `url("${thumb}")` } : {}, html: thumb ? '' : icon('studio-block', 28) }),
        e.published ? h('span', { class: 'studio-card-tag', text: t(T.published) }) : null,
        del,
        h('div', { class: 'studio-card-body' }, h('b', { text: e.title || t(T.untitled) }), h('span', { text: `${t(T.edited, { ago: ago(e.updated) })} · ${t(T.parts, { n: e.parts ?? 0 })}` })),
      );
      recent.appendChild(card);
    }
    const body = h(
      'div',
      { class: 'modal-body' },
      sec(T.newExp),
      h('div', { class: 'studio-templates' }, ['baseplate', 'obby', 'empty'].map(tplCard)),
      sec(T.drafts, h('span', { class: 'studio-dim', text: list.length ? String(list.length) : '' })),
      recent,
    );
    if (store.cloud.available()) {
      const cloudGrid = h('div', { class: 'studio-recent' }, h('div', { class: 'studio-empty', text: t(T.loading) }));
      body.append(sec(T.cloud), cloudGrid);
      store.cloud
        .mine()
        .then((items) => {
          cloudGrid.replaceChildren();
          const known = new Set(list.map((e) => e.cloudId).filter(Boolean));
          for (const x of items.filter((x) => !known.has(String(x.id))).slice(0, 24)) {
            const img = typeof x.thumbnail === 'string' && /^data:image\/|^\/api\//.test(x.thumbnail) ? x.thumbnail : x.thumbRev ? `/api/experiences/${encodeURIComponent(x.id)}/thumbnail?rev=${x.thumbRev}` : null;
            cloudGrid.appendChild(
              h(
                'div',
                { class: 'studio-card', onclick: () => {
                  close();
                  studio.openCloud(String(x.id), x.title);
                } },
                h('div', { class: 'studio-card-img', style: img ? { backgroundImage: `url("${img}")` } : {}, html: img ? '' : icon('globe', 26) }),
                x.version > 0 || x.publishedAt ? h('span', { class: 'studio-card-tag', text: t(T.published) }) : null,
                h('div', { class: 'studio-card-body' }, h('b', { text: x.title || t(T.untitled) }), h('span', { text: t(T.edited, { ago: ago(x.updatedAt || x.draftSavedAt || x.publishedAt) }) })),
              ),
            );
          }
          if (!cloudGrid.children.length) cloudGrid.previousElementSibling?.remove(), cloudGrid.remove();
        })
        .catch(() => cloudGrid.replaceChildren());
    }
    body.appendChild(h('div', { class: 'studio-dlg-foot' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => {
      close();
      if (!ed.exp) studio.exitStudio();
    } }, h('span', { html: icon('chevron-left', 14) }), t(T.back))));
    const el = h('div', { class: 'studio-dlg is-wide studio-start' }, head(T.studio, T.tagline, canClose ? close : null), body);
    ui.openModal('studio-start', el, {
      closeOnEsc: true,
      closeOnBackdrop: false,
      onClose: () => {
        if (!ed.exp) studio.exitStudio();
      },
    });
  }

  // ---------------------------------------------------------------- settings
  function openSettings() {
    if (!ed.exp) return;
    const exp = ed.exp;
    const set = (key, fn) => ed.transact('settings', () => {
      ed.touchSettings();
      fn(ed.exp);
    }, { coalesce: `settings:${key}` });
    const fieldRow = (label, control) => h('div', { class: 'studio-field' }, h('label', { text: t(label) }), control);
    const rangeRow = (value, min, max, step, fmt, onInput) => {
      const out = h('output', { text: fmt(value) });
      const inp = h('input', { type: 'range', min, max, step, value });
      inp.addEventListener('input', () => {
        out.textContent = fmt(+inp.value);
        onInput(+inp.value);
      });
      return h('div', { class: 'studio-range' }, inp, out);
    };
    const title = h('input', { type: 'text', value: exp.meta.title, maxlength: LIMITS.title, placeholder: t(T.untitled) });
    title.addEventListener('input', () => set('title', (e) => (e.meta.title = filterText(title.value, LIMITS.title))));
    const desc = h('textarea', { maxlength: LIMITS.description }, exp.meta.description);
    desc.addEventListener('input', () => set('desc', (e) => (e.meta.description = filterText(desc.value, LIMITS.description))));
    const skies = h('div', { class: 'studio-skies' });
    let timeOut = null;
    const renderSkies = () => {
      skies.replaceChildren(
        ...SKIES.map((s) =>
          h('button', { type: 'button', class: `studio-sky${exp.settings.sky === s ? ' is-on' : ''}`, dataset: { sky: s }, text: t(T.skies[s]), onclick: () => {
            set(`sky${s}`, (e) => {
              e.settings.sky = s;
              e.settings.time = SKY_TIME[s];
            });
            renderSkies();
            if (timeOut) {
              timeOut.querySelector('input').value = SKY_TIME[s];
              timeOut.querySelector('output').textContent = hhmm(SKY_TIME[s]);
            }
          } }),
        ),
      );
    };
    renderSkies();
    timeOut = rangeRow(exp.settings.time, 0, 23.75, 0.25, hhmm, (v) => set('time', (e) => (e.settings.time = v)));
    const bpSw = h('div', { class: 'studio-swatches' });
    const renderBp = () =>
      bpSw.replaceChildren(
        ...PALETTE.map((c) =>
          h('button', { type: 'button', class: `studio-swatch${exp.settings.baseplate.color === c ? ' is-on' : ''}`, style: { background: c }, onclick: () => {
            set('bpc', (e) => (e.settings.baseplate.color = c));
            renderBp();
          } }),
        ),
      );
    renderBp();
    const bpMat = h('select', {});
    for (const m of MATERIALS) bpMat.appendChild(h('option', { value: m, selected: m === exp.settings.baseplate.material ? 'selected' : null, text: t(MATERIAL_NAMES[m]) }));
    bpMat.addEventListener('change', () => set('bpm', (e) => (e.settings.baseplate.material = bpMat.value)));
    const body = h(
      'div',
      { class: 'modal-body' },
      fieldRow(T.title, title),
      fieldRow(T.description, desc),
      sec(T.sky),
      skies,
      fieldRow(T.time, timeOut),
      fieldRow(T.gravity, rangeRow(exp.settings.gravity, 0.2, 3, 0.05, (v) => `× ${v.toFixed(2)}`, (v) => set('grav', (e) => (e.settings.gravity = v)))),
      sec(T.baseplate),
      fieldRow(T.baseplate, rangeRow(exp.settings.baseplate.size, 0, 1024, 16, (v) => (v ? `${v} m` : t(T.none)), (v) => set('bps', (e) => (e.settings.baseplate.size = v)))),
      h('div', { class: 'studio-field', style: { alignItems: 'start' } }, h('label', { text: t(T.bpColor) }), bpSw),
      fieldRow(T.bpMat, bpMat),
      sec(T.maxPlayers),
      fieldRow(T.maxPlayers, rangeRow(exp.meta.maxPlayers, 1, 50, 1, (v) => String(v), (v) => set('maxp', (e) => (e.meta.maxPlayers = v)))),
      h('div', { class: 'studio-dlg-foot' }, h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => ui.closeModal('studio-settings'), text: t(T.done) })),
    );
    for (const el of body.querySelectorAll('input, textarea, select')) el.addEventListener('keydown', (e) => e.key !== 'Escape' && e.stopPropagation());
    ui.openModal('studio-settings', h('div', { class: 'studio-dlg' }, head(T.settings, T.settingsSub, () => ui.closeModal('studio-settings')), body), { closeOnBackdrop: true });
  }

  // ----------------------------------------------------------------- publish
  function openPublish() {
    if (!ed.exp) return;
    const exp = ed.exp;
    let thumb = ed.captureThumb(480, 270);
    const thumbEl = h('div', { class: 'studio-thumb', style: thumb ? { backgroundImage: `url("${thumb}")` } : {} });
    thumbEl.appendChild(h('button', { type: 'button', class: 'studio-ibtn', html: icon('camera', 15), onclick: () => {
      ui.closeModal('studio-publish');
      // re-frame: the player can move the camera, then publish again
      ui.toast({ title: t({ en: 'Frame the shot, then press Publish', nl: 'Kies je beeld en druk op Publiceren' }), icon: 'camera', duration: 2600 });
    } }, h('span', { text: t(T.retake) })));
    const title = h('input', { type: 'text', value: exp.meta.title, maxlength: LIMITS.title, placeholder: t(T.untitled) });
    const desc = h('textarea', { maxlength: LIMITS.description }, exp.meta.description);
    const maxOut = h('output', { text: String(exp.meta.maxPlayers) });
    const maxIn = h('input', { type: 'range', min: 1, max: 50, step: 1, value: exp.meta.maxPlayers });
    maxIn.addEventListener('input', () => (maxOut.textContent = maxIn.value));
    const cloud = store.cloud.available();
    const user = ctx.platform?.user;
    const note = h('div', { class: `studio-note${cloud ? '' : ' is-warn'}` }, h('span', { html: icon(cloud ? 'globe' : 'info', 16) }), h('div', { html: cloud ? t(T.signedIn, { name: escapeHtml(user?.username || user?.name || '') }) : t(T.local) }));
    const err = h('div', { class: 'studio-note is-warn', hidden: true });
    const pubBtn = h('button', { class: 'btn btn-primary btn-sm', type: 'button', html: icon('studio-publish', 15) }, h('span', { text: t(T.publish) }));
    const foot = h(
      'div',
      { class: 'studio-dlg-foot' },
      !cloud && typeof ctx.platform?.login === 'function' ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: t(T.signIn), onclick: () => {
        ui.closeModal('studio-publish');
        try {
          ctx.platform.login();
        } catch (e2) {
          console.warn('[studio] login failed', e2);
        }
      } }) : null,
      h('div', { class: 'studio-grow' }),
      h('button', { class: 'btn btn-sm', type: 'button', text: t(T.cancel), onclick: () => ui.closeModal('studio-publish') }),
      pubBtn,
    );
    const body = h(
      'div',
      { class: 'modal-body' },
      h(
        'div',
        { class: 'studio-pubgrid' },
        h('div', {}, thumbEl),
        h('div', {}, h('div', { class: 'studio-field' }, h('label', { text: t(T.title) }), title), h('div', { class: 'studio-field' }, h('label', { text: t(T.description) }), desc), h('div', { class: 'studio-field' }, h('label', { text: t(T.maxPlayers) }), h('div', { class: 'studio-range' }, maxIn, maxOut))),
      ),
      h('div', { style: { marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '8px' } }, note, err),
      foot,
    );
    for (const el of body.querySelectorAll('input, textarea')) el.addEventListener('keydown', (e) => e.key !== 'Escape' && e.stopPropagation());
    const dlg = h('div', { class: 'studio-dlg is-wide' }, head(T.publish, T.publishSub, () => ui.closeModal('studio-publish')), body);
    pubBtn.addEventListener('click', async () => {
      err.hidden = true;
      const name = filterText(title.value.trim(), LIMITS.title);
      if (!name) {
        err.hidden = false;
        err.textContent = t(T.noTitle);
        title.focus();
        return;
      }
      if (!ed.exp.parts.some((p) => p.type === 'spawn')) {
        err.hidden = false;
        err.textContent = t(T.noSpawn);
        return;
      }
      ed.transact('publish meta', () => {
        ed.touchSettings();
        ed.exp.meta.title = name;
        ed.exp.meta.description = filterText(desc.value, LIMITS.description);
        ed.exp.meta.maxPlayers = Math.max(1, Math.min(50, +maxIn.value || 20));
      });
      pubBtn.disabled = true;
      pubBtn.lastChild.textContent = t(T.publishing);
      try {
        const res = await studio.publish({ thumbnail: thumb });
        showDone(res);
      } catch (e) {
        console.warn('[studio] publish failed', e);
        err.hidden = false;
        err.textContent = t(T.failed, { msg: e?.message || e?.code || '?' });
        pubBtn.disabled = false;
        pubBtn.lastChild.textContent = t(T.publish);
      }
    });
    function showDone(res) {
      body.replaceChildren(
        h(
          'div',
          { class: 'studio-done' },
          h('div', { class: 'studio-done-icon', html: icon('check', 30) }),
          h('h3', { text: t(T.doneTitle) }),
          h('p', { text: t(res.cloud ? T.doneCloud : T.doneLocal, { title: ed.exp.meta.title }) }),
          h(
            'div',
            { class: 'studio-dlg-foot', style: { justifyContent: 'center' } },
            h('button', { class: 'btn btn-sm', type: 'button', text: t(T.done), onclick: () => ui.closeModal('studio-publish') }),
            h('button', { class: 'btn btn-primary btn-sm', type: 'button', html: icon('studio-play', 14), onclick: () => {
              ui.closeModal('studio-publish');
              studio.playTest();
            } }, h('span', { text: t(T.playNow) })),
          ),
        ),
      );
      ctx.audio?.play?.('reward', { volume: 0.6 });
    }
    ui.openModal('studio-publish', dlg, { closeOnBackdrop: false });
    // a fresh thumbnail after the modal paints (the first frame may still hold the HUD-free view)
    requestAnimationFrame(() => {
      const again = ed.captureThumb(480, 270);
      if (again) {
        thumb = again;
        thumbEl.style.backgroundImage = `url("${again}")`;
      }
    });
  }

  return { openStart, openSettings, openPublish };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
