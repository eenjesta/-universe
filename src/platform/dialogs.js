/**
 * Platform dialogs (ui.openModal): sign in / create account / save your
 * progress (guest → account, birth-year age gate + privacy text), the
 * experience page (play, like, report, edit/delete for the owner), the report
 * dialog and the privacy & safety sheet. Text is resolved when built.
 */
import { t, locale } from '../core/i18n.js';
import { icon } from '../ui/icons.js';
import { errorText } from './api.js';
import { experienceArt } from './thumbs.js';
import { markSVG } from './home.js';
import { checkUsername, checkPassword, checkBirthYear, cleanUsername, passwordStrength, isUnder13, birthYears, compactNumber, relativeTime, PASSWORD_MIN } from './validate.js';

const AUTH_ID = 'platform-auth';
const EXP_ID = 'platform-experience';
const REPORT_ID = 'platform-report';
const SAFETY_ID = 'platform-safety';

const PRIVACY = {
  en: 'We only store your username, a secure hash of your password and your birth year — no e-mail address, no real name. Your birth year sets age-appropriate safety: for players under 13, chat and friend features are restricted by default. Never share your password; Ø Universe will never ask for it.',
  nl: 'We bewaren alleen je gebruikersnaam, een veilige hash van je wachtwoord en je geboortejaar — geen e-mailadres, geen echte naam. Je geboortejaar bepaalt de veiligheidsinstellingen: voor spelers onder 13 zijn chat en vrienden standaard beperkt. Deel nooit je wachtwoord; Ø Universe zal er nooit om vragen.',
};

const FIELD_ERRORS = {
  username_short: { en: 'Use at least 3 characters.', nl: 'Gebruik minstens 3 tekens.' },
  username_long: { en: 'Use at most 20 characters.', nl: 'Gebruik maximaal 20 tekens.' },
  username_chars: { en: 'Only a–z, 0–9 and _ are allowed.', nl: 'Alleen a–z, 0–9 en _ zijn toegestaan.' },
  password_short: { en: 'Use at least {n} characters.', nl: 'Gebruik minstens {n} tekens.' },
  password_long: { en: 'That password is too long.', nl: 'Dat wachtwoord is te lang.' },
  password_same: { en: "Your password can't contain your username.", nl: 'Je wachtwoord mag je gebruikersnaam niet bevatten.' },
  birth_missing: { en: 'Please choose your birth year.', nl: 'Kies je geboortejaar.' },
  birth_range: { en: 'Please choose a valid birth year.', nl: 'Kies een geldig geboortejaar.' },
};
const fieldError = (code) => (code ? t(FIELD_ERRORS[code] || { en: 'Please check this field.', nl: 'Controleer dit veld.' }, { n: PASSWORD_MIN }) : '');

const REPORT_REASONS = [
  ['inappropriate', { en: 'Inappropriate content', nl: 'Ongepaste inhoud' }],
  ['harassment', { en: 'Bullying or harassment', nl: 'Pesten of intimidatie' }],
  ['personal_info', { en: 'Asking for or sharing personal information', nl: 'Vraagt om of deelt persoonlijke gegevens' }],
  ['scam', { en: 'Scams, cheats or exploits', nl: 'Oplichting, cheats of exploits' }],
  ['other', { en: 'Something else', nl: 'Iets anders' }],
];

export function createDialogs(ctx, core) {
  const { ui } = ctx;
  const h = ui.h;

  const closeBtn = (id) => h('button', { class: 'modal-close plat-dialog-close', type: 'button', 'aria-label': t({ en: 'Close', nl: 'Sluiten' }), html: icon('close', 20), onclick: () => ui.closeModal(id) });
  const spinner = () => h('span', { class: 'plat-spin', 'aria-hidden': 'true' });

  // ------------------------------------------------------------------ auth
  /**
   * mode: 'signin' | 'register' | 'save' (register, framed as guest → account).
   * opts.reason: optional line explaining why sign-in is needed ("Sign in to like…").
   * Resolves with the user, or null when closed.
   */
  async function auth(mode = 'signin', opts = {}) {
    if (!core.online && !core.probed) await core.whenProbed();
    if (!core.online) {
      ui.toast({ title: t({ en: 'Offline', nl: 'Offline' }), text: t({ en: 'Sign-in is unavailable while offline.', nl: 'Inloggen is niet beschikbaar zolang je offline bent.' }), icon: 'plat-offline', kind: 'warn' });
      return null;
    }
    if (ui.isModalOpen(AUTH_ID)) ui.closeModal(AUTH_ID); // resolves a pending auth() with null
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        resolve(v);
      };
      const el = buildAuth(mode, opts, (user) => {
        finish(user);
        ui.closeModal(AUTH_ID);
      });
      ui.openModal(AUTH_ID, el, { className: 'plat-modal-wrap', onClose: () => finish(core.user || null), closeOnBackdrop: false });
      requestAnimationFrame(() => el.querySelector('input')?.focus({ preventScroll: true }));
    });
  }

  function buildAuth(mode, opts, onDone) {
    const reg = mode !== 'signin';
    const titles = {
      signin: [{ en: 'Sign in', nl: 'Inloggen' }, { en: 'Welcome back to Ø Universe.', nl: 'Welkom terug in Ø Universe.' }],
      register: [{ en: 'Create account', nl: 'Account maken' }, { en: "Join Ø Universe — it's free.", nl: 'Doe mee met Ø Universe — het is gratis.' }],
      save: [
        { en: 'Save your progress', nl: 'Bewaar je voortgang' },
        { en: 'Create a free account to keep your character, inventory and creations — and play on any device.', nl: 'Maak een gratis account om je personage, inventaris en creaties te bewaren — en speel op elk apparaat.' },
      ],
    };
    const [title, sub] = titles[mode] || titles.signin;
    const uid = `plat-${Math.random().toString(36).slice(2, 7)}`;

    const user = h('input', { id: `${uid}-u`, class: 'plat-input', name: 'username', type: 'text', maxlength: '20', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, 'aria-describedby': `${uid}-uh` });
    const pass = h('input', { id: `${uid}-p`, class: 'plat-input', name: 'password', type: 'password', maxlength: '128', autocomplete: reg ? 'new-password' : 'current-password', required: true, 'aria-describedby': `${uid}-ph` });
    const eye = h('button', {
      class: 'plat-pw-eye',
      type: 'button',
      'aria-label': t({ en: 'Show password', nl: 'Wachtwoord tonen' }),
      'aria-pressed': 'false',
      html: icon('plat-eye', 18),
      onclick: () => {
        const show = pass.type === 'password';
        pass.type = show ? 'text' : 'password';
        eye.innerHTML = icon(show ? 'plat-eye-off' : 'plat-eye', 18);
        eye.setAttribute('aria-pressed', String(show));
        eye.setAttribute('aria-label', show ? t({ en: 'Hide password', nl: 'Wachtwoord verbergen' }) : t({ en: 'Show password', nl: 'Wachtwoord tonen' }));
      },
    });
    const uHint = h('small', { id: `${uid}-uh`, class: 'plat-hint', text: reg ? t({ en: "3–20 characters: a–z, 0–9 and _. Don't use your real name.", nl: '3–20 tekens: a–z, 0–9 en _. Gebruik niet je echte naam.' }) : '' });
    const pHint = h('small', { id: `${uid}-ph`, class: 'plat-hint', text: reg ? t({ en: 'At least {n} characters.', nl: 'Minstens {n} tekens.' }, { n: PASSWORD_MIN }) : '' });
    const meter = reg ? h('div', { class: 'plat-meter', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')) : null;
    let year = null;
    let safeNote = null;
    if (reg) {
      year = h(
        'select',
        { id: `${uid}-y`, class: 'plat-input plat-select', name: 'birthYear', required: true, 'aria-describedby': `${uid}-yh` },
        h('option', { value: '', text: t({ en: 'Select your birth year', nl: 'Kies je geboortejaar' }) }),
        birthYears().map((y) => h('option', { value: String(y), text: String(y) })),
      );
      safeNote = h(
        'div',
        { class: 'plat-note is-safe', hidden: true, role: 'note' },
        h('span', { html: icon('shield', 16) }),
        h('span', {
          text: t({
            en: "Because you're under 13, chat and friend requests will be restricted to keep you safe. Please ask a parent or guardian before creating an account.",
            nl: 'Omdat je jonger bent dan 13, worden chat en vriendschapsverzoeken beperkt voor je veiligheid. Vraag een ouder of verzorger voordat je een account maakt.',
          }),
        }),
      );
      year.addEventListener('change', () => {
        safeNote.hidden = !(year.value && isUnder13(year.value));
        setFieldError(year, '');
      });
    }
    const errLine = h('div', { class: 'plat-form-error', role: 'alert' });
    const submit = h('button', { class: 'btn btn-primary plat-submit', type: 'submit' }, h('span', { class: 'plat-btn-label', text: reg ? t({ en: 'Create account', nl: 'Account maken' }) : t({ en: 'Sign in', nl: 'Inloggen' }) }));

    function setFieldError(input, msg) {
      const field = input.closest('.plat-field');
      field?.classList.toggle('is-invalid', !!msg);
      input.setAttribute('aria-invalid', msg ? 'true' : 'false');
      const hint = field?.querySelector('.plat-hint');
      if (hint) {
        if (!hint.dataset.base) hint.dataset.base = hint.textContent;
        hint.textContent = msg || hint.dataset.base;
      }
    }

    user.addEventListener('input', () => {
      const v = cleanUsername(user.value);
      if (reg && v !== user.value) {
        const pos = user.selectionStart;
        user.value = v;
        user.setSelectionRange?.(pos, pos);
      }
      setFieldError(user, '');
      errLine.textContent = '';
    });
    pass.addEventListener('input', () => {
      setFieldError(pass, '');
      errLine.textContent = '';
      if (meter) meter.dataset.level = String(passwordStrength(pass.value));
    });

    const form = h(
      'form',
      {
        class: 'plat-form',
        novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          errLine.textContent = '';
          const uErr = reg ? checkUsername(user.value) : user.value.trim() ? null : 'username_short';
          const pErr = reg ? checkPassword(pass.value, user.value) : pass.value ? null : 'password_short';
          const yErr = reg ? checkBirthYear(year.value) : null;
          setFieldError(user, reg || uErr ? fieldError(uErr) : '');
          setFieldError(pass, reg || pErr ? fieldError(pErr) : '');
          if (year) setFieldError(year, fieldError(yErr));
          if (uErr || pErr || yErr) {
            (uErr ? user : pErr ? pass : year).focus();
            if (!reg) errLine.textContent = t({ en: 'Enter your username and password.', nl: 'Vul je gebruikersnaam en wachtwoord in.' });
            return;
          }
          submit.disabled = true;
          submit.prepend(spinner());
          try {
            const u = reg ? await core.register({ username: user.value, password: pass.value, birthYear: Number(year.value) }) : await core.login(user.value, pass.value);
            ui.toast(
              reg
                ? {
                    title: mode === 'save' ? t({ en: 'Progress saved', nl: 'Voortgang bewaard' }) : t({ en: 'Account created', nl: 'Account aangemaakt' }),
                    text: t({ en: 'Welcome, @{u}! Your progress is now saved to your account.', nl: 'Welkom, @{u}! Je voortgang wordt nu bewaard in je account.' }, { u: u.username }),
                    icon: 'plat-cloud',
                    kind: 'success',
                  }
                : { title: t({ en: 'Signed in', nl: 'Ingelogd' }), text: t({ en: 'Welcome back, @{u}.', nl: 'Welkom terug, @{u}.' }, { u: u.username }), icon: 'user', kind: 'success' },
            );
            onDone(u);
          } catch (err) {
            errLine.textContent = errorText(err);
            const c = String(err.code || '').toLowerCase();
            if (/user|name|taken|exists|filter/.test(c)) {
              setFieldError(user, errorText(err));
              user.focus();
            } else if (/password|credential/.test(c)) pass.focus();
            else if (/birth|age/.test(c) && year) year.focus();
          } finally {
            submit.disabled = false;
            submit.querySelector('.plat-spin')?.remove();
          }
        },
      },
      h('label', { class: 'plat-field', for: `${uid}-u` }, h('span', { class: 'plat-label', text: t({ en: 'Username', nl: 'Gebruikersnaam' }) }), user, uHint),
      h('label', { class: 'plat-field', for: `${uid}-p` }, h('span', { class: 'plat-label', text: t({ en: 'Password', nl: 'Wachtwoord' }) }), h('div', { class: 'plat-pw' }, pass, eye), meter, pHint),
      year
        ? h(
            'label',
            { class: 'plat-field', for: `${uid}-y` },
            h('span', { class: 'plat-label', text: t({ en: 'Birth year', nl: 'Geboortejaar' }) }),
            year,
            h('small', { id: `${uid}-yh`, class: 'plat-hint', text: t({ en: 'Only used for age-appropriate safety settings. Never shown to others.', nl: 'Alleen gebruikt voor veiligheidsinstellingen per leeftijd. Nooit zichtbaar voor anderen.' }) }),
          )
        : null,
      safeNote,
      errLine,
      submit,
    );

    const switcher = reg
      ? h('p', { class: 'plat-switch' }, t({ en: 'Already have an account?', nl: 'Heb je al een account?' }), ' ', h('button', { class: 'plat-link', type: 'button', text: t({ en: 'Sign in', nl: 'Inloggen' }), onclick: () => swap('signin') }))
      : h('p', { class: 'plat-switch' }, t({ en: 'New to Ø Universe?', nl: 'Nieuw in Ø Universe?' }), ' ', h('button', { class: 'plat-link', type: 'button', text: t({ en: 'Create an account', nl: 'Maak een account' }), onclick: () => swap(core.hasGuestProgress() ? 'save' : 'register') }));

    const el = h(
      'div',
      { class: 'plat-dialog plat-auth', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `${uid}-t` },
      closeBtn(AUTH_ID),
      h('div', { class: 'plat-auth-head' }, h('span', { class: 'plat-auth-mark', html: markSVG(40, 4.5) }), h('h2', { id: `${uid}-t`, class: 'plat-dialog-title', text: t(title) }), h('p', { class: 'plat-dialog-sub', text: opts.reason ? t(opts.reason) : t(sub) })),
      form,
      switcher,
      h('p', { class: 'plat-privacy' }, h('span', { html: icon('shield', 14) }), h('span', { text: t(PRIVACY) })),
    );

    function swap(next) {
      const fresh = buildAuth(next, { reason: opts.reason }, onDone);
      el.replaceWith(fresh);
      // keep the modal record pointing at the live element
      const rec = ui.modals.find((m) => m.id === AUTH_ID);
      if (rec) {
        fresh.classList.add('modal');
        rec.el = fresh;
      }
      requestAnimationFrame(() => fresh.querySelector('input')?.focus({ preventScroll: true }));
    }
    return el;
  }

  // ----------------------------------------------------------- experience
  function experience(exp, { mine = false } = {}) {
    if (!exp) return;
    let cur = { ...exp };
    const own = !!(mine || exp.local || (core.user && exp.creator && exp.creator === core.user.username));
    const img = h('img', { class: 'plat-exp-img', alt: '', decoding: 'async', src: cur.thumbnail || experienceArt(cur, 640, 360) });
    img.addEventListener('error', () => (img.src = experienceArt(cur, 640, 360)), { once: true });
    const likeBtn = h('button', { class: 'plat-chipbtn plat-like', type: 'button', 'aria-pressed': 'false' });
    const playBtn = h('button', { class: 'plat-play', type: 'button' }, h('span', { class: 'plat-play-icon', html: icon('play', 18) }), h('span', { class: 'plat-play-label', text: t({ en: 'Play', nl: 'Speel' }) }));
    const stats = h('dl', { class: 'plat-exp-stats' });
    const desc = h('p', { class: 'plat-exp-desc' });
    const status = h('div', { class: 'plat-form-error', role: 'alert' });
    const by = h('div', { class: 'plat-exp-by' });
    const actions = h('div', { class: 'plat-exp-actions' });

    function renderInfo() {
      by.replaceChildren(
        cur.local ? t({ en: 'Local draft on this device', nl: 'Lokaal concept op dit apparaat' }) : cur.creator ? t({ en: 'by @{u}', nl: 'door @{u}' }, { u: cur.creator }) : '',
        ...(cur.updatedAt ? [h('span', { class: 'plat-exp-when', text: ` · ${t({ en: 'Updated {when}', nl: 'Bijgewerkt {when}' }, { when: relativeTime(cur.updatedAt, locale()) })}` })] : []),
      );
      likeBtn.replaceChildren(h('span', { html: icon(cur.liked ? 'plat-heart-fill' : 'plat-heart', 17) }), h('span', { text: compactNumber(cur.likes, locale()) }));
      likeBtn.classList.toggle('is-on', !!cur.liked);
      likeBtn.setAttribute('aria-pressed', String(!!cur.liked));
      likeBtn.setAttribute('aria-label', cur.liked ? t({ en: 'Unlike ({n} likes)', nl: 'Niet meer leuk ({n} likes)' }, { n: cur.likes }) : t({ en: 'Like ({n} likes)', nl: 'Leuk ({n} likes)' }, { n: cur.likes }));
      likeBtn.hidden = !!cur.local || !cur.published;
      const stat = (k, v) => h('div', { class: 'plat-exp-stat' }, h('dt', { text: k }), h('dd', { text: v }));
      stats.replaceChildren(
        ...(cur.local
          ? [
              stat(t({ en: 'Parts', nl: 'Onderdelen' }), cur.partCount ? compactNumber(cur.partCount, locale()) : '—'),
              stat(t({ en: 'Saved', nl: 'Opgeslagen' }), relativeTime(cur.updatedAt, locale()) || '—'),
              stat(t({ en: 'Status', nl: 'Status' }), cur.published ? t({ en: 'Published on this device', nl: 'Gepubliceerd op dit apparaat' }) : t({ en: 'Draft', nl: 'Concept' })),
            ]
          : [
              stat(t({ en: 'Plays', nl: 'Gespeeld' }), compactNumber(cur.plays, locale())),
              stat(t({ en: 'Likes', nl: 'Likes' }), compactNumber(cur.likes, locale())),
              stat(t({ en: 'Max players', nl: 'Max. spelers' }), cur.maxPlayers ? String(cur.maxPlayers) : '—'),
              stat(t({ en: 'Status', nl: 'Status' }), cur.published ? t({ en: 'Published', nl: 'Gepubliceerd' }) : t({ en: 'Draft', nl: 'Concept' })),
            ]),
      );
      desc.textContent = cur.description || t({ en: 'No description yet.', nl: 'Nog geen beschrijving.' });
      desc.classList.toggle('is-empty', !cur.description);
      // local creations play from this device (published copy, else the draft); cloud ones need a version
      const canPlay = cur.local ? true : cur.published;
      playBtn.disabled = !canPlay;
      playBtn.title = canPlay ? '' : t({ en: 'Publish this experience in Ø Studio to play it here.', nl: 'Publiceer deze ervaring in Ø Studio om hem hier te spelen.' });
      const kids = [likeBtn];
      if (own) {
        kids.push(
          h(
            'button',
            { class: 'plat-chipbtn', type: 'button', onclick: () => core.actions.openStudio(cur.id, cur) },
            h('span', { html: icon('plat-edit', 16) }),
            h('span', { text: t({ en: 'Edit in Ø Studio', nl: 'Bewerken in Ø Studio' }) }),
          ),
        );
        if (!cur.local) kids.push(h('button', { class: 'plat-chipbtn is-danger', type: 'button', onclick: () => confirmDelete() }, h('span', { html: icon('trash', 16) }), h('span', { text: t({ en: 'Delete', nl: 'Verwijderen' }) })));
      } else {
        kids.push(
          h(
            'button',
            { class: 'plat-chipbtn', type: 'button', onclick: () => report({ kind: 'experience', targetId: cur.id, label: cur.title }) },
            h('span', { html: icon('plat-flag', 16) }),
            h('span', { text: t({ en: 'Report', nl: 'Melden' }) }),
          ),
        );
      }
      actions.replaceChildren(...kids);
    }

    likeBtn.addEventListener('click', async () => {
      if (!core.user) {
        const u = await auth('signin', { reason: { en: 'Sign in to like experiences.', nl: 'Log in om ervaringen leuk te vinden.' } });
        if (!u) return;
      }
      const prev = { liked: cur.liked, likes: cur.likes };
      cur.liked = !cur.liked;
      cur.likes = Math.max(0, cur.likes + (cur.liked ? 1 : -1));
      renderInfo();
      likeBtn.disabled = true;
      try {
        const r = await core.experiences.like(cur.id, cur.liked);
        if (r && typeof r.liked === 'boolean') cur.liked = r.liked;
        if (r && Number.isFinite(Number(r.likes))) cur.likes = Number(r.likes);
        core.home?.patchExperience(cur);
      } catch (err) {
        Object.assign(cur, prev);
        status.textContent = errorText(err);
      } finally {
        likeBtn.disabled = false;
        renderInfo();
      }
    });

    playBtn.addEventListener('click', async () => {
      if (playBtn.disabled) return;
      playBtn.disabled = true;
      playBtn.prepend(spinner());
      status.textContent = '';
      try {
        const ok = await core.actions.playExperience(cur);
        if (ok) ui.closeModal(EXP_ID);
      } catch (err) {
        status.textContent = errorText(err);
      } finally {
        playBtn.disabled = false;
        playBtn.querySelector('.plat-spin')?.remove();
      }
    });

    function confirmDelete() {
      const bar = h(
        'div',
        { class: 'plat-confirm', role: 'alertdialog' },
        h('span', { text: t({ en: "Delete “{x}”? This can't be undone.", nl: '“{x}” verwijderen? Dit kan niet ongedaan worden.' }, { x: cur.title }) }),
        h('button', { class: 'btn btn-sm', type: 'button', text: t({ en: 'Cancel', nl: 'Annuleren' }), onclick: () => bar.remove() }),
        h('button', {
          class: 'btn btn-sm plat-btn-danger',
          type: 'button',
          text: t({ en: 'Delete', nl: 'Verwijderen' }),
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            try {
              await core.experiences.remove(cur.id);
              ui.closeModal(EXP_ID);
              core.home?.removeExperience(cur.id);
              ui.toast({ title: t({ en: 'Experience deleted', nl: 'Ervaring verwijderd' }), text: cur.title, icon: 'trash' });
            } catch (err) {
              status.textContent = errorText(err);
              bar.remove();
            }
          },
        }),
      );
      actions.after(bar);
      bar.querySelector('button')?.focus();
    }

    const el = h(
      'div',
      { class: 'plat-dialog plat-exp', role: 'dialog', 'aria-modal': 'true', 'aria-label': cur.title },
      h('div', { class: 'plat-exp-banner' }, img, h('div', { class: 'plat-exp-shade' }), closeBtn(EXP_ID)),
      h(
        'div',
        { class: 'plat-exp-body' },
        h('div', { class: 'plat-exp-top' }, h('div', { class: 'plat-exp-titles' }, h('h2', { class: 'plat-dialog-title', text: cur.title }), by), playBtn),
        actions,
        status,
        stats,
        desc,
        h('p', { class: 'plat-exp-note' }, h('span', { html: icon('info', 14) }), t({ en: 'User experiences are single-player in this version — multiplayer per experience is coming.', nl: 'Ervaringen van spelers zijn in deze versie singleplayer — multiplayer per ervaring komt eraan.' })),
      ),
    );
    renderInfo();
    ui.openModal(EXP_ID, el, { className: 'plat-modal-wrap' });
    requestAnimationFrame(() => playBtn.focus({ preventScroll: true }));

    // full details (description, liked state, published version) from the API
    if (!cur.local && core.online) {
      core.experiences
        .get(cur.id)
        .then((full) => {
          if (!full || !el.isConnected) return;
          cur = { ...cur, ...full, thumbnail: full.thumbnail || cur.thumbnail, creator: full.creator || cur.creator };
          if (full.thumbnail && img.src !== full.thumbnail) img.src = full.thumbnail;
          renderInfo();
        })
        .catch((err) => {
          if (el.isConnected && err.status === 404) status.textContent = errorText(err);
        });
    }
  }

  // ---------------------------------------------------------------- report
  function report({ kind, targetId, label }) {
    const uid = `plat-r${Math.random().toString(36).slice(2, 7)}`;
    let reason = null;
    const err = h('div', { class: 'plat-form-error', role: 'alert' });
    const details = h('textarea', { class: 'plat-input plat-textarea', maxlength: '300', rows: '3', placeholder: t({ en: 'Tell us more (optional)', nl: 'Vertel ons meer (optioneel)' }), 'aria-label': t({ en: 'Details', nl: 'Details' }) });
    const send = h('button', { class: 'btn btn-primary', type: 'submit', disabled: true }, h('span', { class: 'plat-btn-label', text: t({ en: 'Send report', nl: 'Melding versturen' }) }));
    const options = h(
      'div',
      { class: 'plat-reasons', role: 'radiogroup', 'aria-labelledby': `${uid}-t` },
      REPORT_REASONS.map(([id, text]) =>
        h(
          'label',
          { class: 'plat-reason' },
          h('input', {
            type: 'radio',
            name: `${uid}-reason`,
            value: id,
            onchange: () => {
              reason = id;
              send.disabled = false;
            },
          }),
          h('span', { class: 'plat-reason-dot' }),
          h('span', { text: t(text) }),
        ),
      ),
    );
    const el = h(
      'div',
      { class: 'plat-dialog plat-report', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `${uid}-t` },
      closeBtn(REPORT_ID),
      h('h2', { id: `${uid}-t`, class: 'plat-dialog-title' }, h('span', { html: icon('plat-flag', 18) }), t({ en: 'Report {x}', nl: '{x} melden' }, { x: label || '' })),
      h('p', { class: 'plat-dialog-sub', text: t({ en: 'Thanks for helping keep Ø Universe safe. Reports are private — the person you report is not told who sent it.', nl: 'Bedankt dat je Ø Universe veilig helpt houden. Meldingen zijn privé — degene die je meldt, hoort niet van wie hij komt.' }) }),
      h(
        'form',
        {
          class: 'plat-form',
          onsubmit: async (e) => {
            e.preventDefault();
            if (!reason) return;
            send.disabled = true;
            send.prepend(spinner());
            err.textContent = '';
            try {
              await core.report({ kind, targetId, reason, details: details.value.trim().slice(0, 300) });
              ui.closeModal(REPORT_ID);
              ui.toast({ title: t({ en: 'Report sent', nl: 'Melding verstuurd' }), text: t({ en: 'Thank you. Our moderators will take a look.', nl: 'Bedankt. Onze moderators gaan ernaar kijken.' }), icon: 'shield', kind: 'success' });
            } catch (e2) {
              err.textContent = errorText(e2);
              send.disabled = false;
            } finally {
              send.querySelector('.plat-spin')?.remove();
            }
          },
        },
        options,
        details,
        err,
        h('div', { class: 'plat-row-btns is-end' }, h('button', { class: 'btn', type: 'button', text: t({ en: 'Cancel', nl: 'Annuleren' }), onclick: () => ui.closeModal(REPORT_ID) }), send),
      ),
      h('p', { class: 'plat-privacy' }, h('span', { html: icon('info', 14) }), t({ en: 'If someone is in danger or asks you to meet in real life, tell a parent, guardian or someone you trust right away.', nl: 'Is iemand in gevaar of vraagt iemand je om in het echt af te spreken? Vertel het meteen aan een ouder, verzorger of iemand die je vertrouwt.' })),
    );
    ui.openModal(REPORT_ID, el, { className: 'plat-modal-wrap' });
    requestAnimationFrame(() => el.querySelector('input')?.focus({ preventScroll: true }));
  }

  // ---------------------------------------------------------------- safety
  function safety() {
    const item = (iconName, title, text) => h('li', { class: 'plat-safety-item' }, h('span', { class: 'plat-safety-icon', html: icon(iconName, 20) }), h('div', {}, h('strong', { text: t(title) }), h('p', { text: t(text) })));
    const el = h(
      'div',
      { class: 'plat-dialog plat-safety', role: 'dialog', 'aria-modal': 'true', 'aria-label': t({ en: 'Privacy & safety', nl: 'Privacy & veiligheid' }) },
      closeBtn(SAFETY_ID),
      h('h2', { class: 'plat-dialog-title' }, h('span', { html: icon('shield', 20) }), t({ en: 'Privacy & safety', nl: 'Privacy & veiligheid' })),
      h(
        'ul',
        { class: 'plat-safety-list' },
        item('plat-lock', { en: 'What we store', nl: 'Wat we bewaren' }, PRIVACY),
        item('chat', { en: 'Filtered chat', nl: 'Gefilterde chat' }, { en: 'Names, titles and chat are filtered for bad words in English and Dutch. Players under 13 get restricted chat and no friend requests by default.', nl: 'Namen, titels en chat worden gefilterd op scheldwoorden in het Engels en Nederlands. Spelers onder 13 krijgen standaard beperkte chat en geen vriendschapsverzoeken.' }),
        item('plat-flag', { en: 'Report anything that feels wrong', nl: 'Meld alles wat niet goed voelt' }, { en: 'Use Report on an experience or a player. Never share your password, address, school or phone number — and never agree to meet someone from the internet.', nl: 'Gebruik Melden bij een ervaring of speler. Deel nooit je wachtwoord, adres, school of telefoonnummer — en spreek nooit af met iemand van internet.' }),
        item('people', { en: 'Friends', nl: 'Vrienden' }, { en: 'Only people you accept become friends. You can remove a friend at any time from the friends list.', nl: 'Alleen mensen die jij accepteert worden vrienden. Je kunt een vriend altijd verwijderen via de vriendenlijst.' }),
      ),
    );
    ui.openModal(SAFETY_ID, el, { className: 'plat-modal-wrap' });
  }

  return { auth, experience, report, safety };
}
