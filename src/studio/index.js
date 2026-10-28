/**
 * Ø Studio — module entry (PLATFORM.md §10): the creation editor (mode 'studio') and the experience
 * runtime (mode 'experience'). Heavy parts (editor, panels, runtime, TransformControls) load lazily on
 * first use, so installing costs almost nothing.
 *
 * ctx.studio = {
 *   available: true,
 *   open(draftId?, { from }?)        → enters Ø Studio: a local draft id, a cloud experience id
 *                                      (signed in), or — without an id — the start screen (templates + drafts)
 *   play(experience, { from, id, creator, test }?) → validates (JSON object/string or an API response
 *                                      holding it) and plays it in mode 'experience'; returns { ok, errors }.
 *                                      `id` = platform experience id (play counter + Report); with
 *                                      from 'home' the platform client counts the play itself
 *   playLocal(id, { from }?)         → plays an experience published on this device (signed out), or the draft
 *   listLocal()                      → [{ id, title, published, pubUpdated, parts, thumbnail }] published locally
 *   drafts()                         → local drafts [{ id, title, updated, parts, cloudId, published }]
 *   validate(json)                   → format.js validate()
 *   createExperience(template)       → 'baseplate' | 'obby' | 'empty' starter JSON
 * }
 * `from` decides where Exit / Leave go: 'home' (ctx.platform.openHome, else title with {home: true}),
 * 'title', or 'studio' (play-tests return to the editor). Events: studio:published {id, cloud, title},
 * studio:play {title, test}. URL hooks (tests): ?mode=studio[&template=obby|baseplate|empty][&draft=<id>],
 * ?mode=experience&template=obby.
 */
import './studio.css';
import { t } from '../core/i18n.js';
import { registerStudioIcons } from './icons.js';
import { validate, ERROR_TEXT } from './format.js';
import { createExperience } from './templates.js';
import { createStore, extractExperience } from './store.js';

const TXT = {
  badExp: { en: "Can't open this experience", nl: 'Deze ervaring kan niet worden geopend' },
  loadFail: { en: "Couldn't load that draft", nl: 'Dat concept kon niet worden geladen' },
  offline: { en: 'Your account is not reachable right now — opened the copy on this device.', nl: 'Je account is nu niet bereikbaar — de kopie op dit apparaat is geopend.' },
  untitled: { en: 'My experience', nl: 'Mijn ervaring' },
  obby: { en: 'My obby', nl: 'Mijn obby' },
};

export async function install(ctx) {
  registerStudioIcons();
  const { modes, ui, events } = ctx;
  const store = createStore(ctx);
  let editor = null;
  let panels = null;
  let dialogs = null;
  let runtime = null;
  let studioFrom = 'title';
  let popEsc = null;

  async function ensureEditor() {
    if (editor) return editor;
    const [{ createEditor }, { createPanels }, { createDialogs }] = await Promise.all([import('./editor.js'), import('./panels.js'), import('./dialogs.js')]);
    editor = createEditor(ctx, { store, studio: api });
    dialogs = createDialogs(ctx, editor, { store, studio: api });
    panels = createPanels(ctx, editor, { dialogs });
    studioMode.scene = editor.scene;
    studioMode.camera = editor.camera;
    return editor;
  }
  async function ensureRuntime() {
    if (runtime) return runtime;
    const { createRuntime } = await import('./runtime.js');
    runtime = createRuntime(ctx, { studio: api });
    expMode.scene = runtime.scene;
    expMode.camera = runtime.camera;
    return runtime;
  }

  const hasHome = () => !!(ctx.platform && ctx.platform.available !== false && typeof ctx.platform.openHome === 'function');
  /** Where Exit / Leave go back to: 'home' | 'title' | a world mode to resume ('explore', 'drive', …). */
  const normFrom = (f) => {
    if (!f || f === 'boot' || f === 'studio' || f === 'experience' || f === 'title' || f === 'home' || !modes.has(f)) return hasHome() ? 'home' : 'title';
    return f;
  };
  const contextOf = () => {
    if (modes.is('studio')) return 'studio';
    if (modes.is('experience')) return normFrom(runtime?.from);
    return normFrom(modes.name);
  };

  async function goHome(target) {
    const from = normFrom(target);
    const p = ctx.platform;
    if ((from === 'home' || from === 'title') && hasHome()) {
      try {
        await p.openHome();
      } catch (err) {
        console.warn('[studio] openHome failed', err);
      }
      if (!modes.is('studio', 'experience')) return;
    }
    if (from !== 'title' && from !== 'home') {
      await modes.go(from, { resume: true });
      return;
    }
    await modes.go('title', { home: from === 'home' && hasHome() });
  }

  // ------------------------------------------------------------ modes
  const studioMode = {
    scene: null,
    camera: null,
    pointerLock: false,
    hud: 'studio',
    async enter(params = {}, from) {
      await ensureEditor();
      if (!params.resume) {
        if (params.from && params.from !== 'studio') studioFrom = normFrom(params.from);
        else if (from !== 'experience') studioFrom = normFrom(from);
      }
      panels.show();
      editor.activate();
      popEsc = ui.pushEscape(() => editor.clearSelection());
      ctx.touch?.setLayout?.('studio', { joystick: false, look: false, jump: false, action: false, buttons: [], menu: false, chat: false });
      const q = params.initial ? ctx.params : params;
      try {
        if (params.resume && editor.exp) {
          // back from a play-test: keep everything
        } else if (params.exp) {
          editor.load(params.exp, { draftId: params.draftId || null, cloudId: params.cloudId || null });
        } else if (q.draft || params.draftId) {
          await loadDraft(String(q.draft || params.draftId));
        } else if (q.template) {
          newDraft(String(q.template), false);
        } else if (!editor.exp || params.start) {
          setTimeout(() => dialogs.openStart({ canClose: !!editor.exp }), 60);
        }
      } catch (err) {
        console.error('[studio] open failed', err);
        ui.toast({ title: t(TXT.loadFail), kind: 'error', icon: 'info' });
        if (!editor.exp) setTimeout(() => dialogs.openStart({ canClose: false }), 60);
      }
      editor.refreshGizmo();
    },
    exit(to) {
      if (!editor) return;
      if (to !== 'experience' && editor.exp) editor.save({ thumb: true, flush: true });
      else if (editor.exp) editor.save();
      editor.deactivate();
      panels.hide();
      popEsc?.();
      popEsc = null;
      for (const id of ['studio-start', 'studio-settings', 'studio-publish']) ui.closeModal(id, { silent: true });
    },
    update(dt) {
      editor?.update(dt);
    },
  };
  const expMode = {
    scene: null,
    camera: null,
    pointerLock: false,
    hud: 'experience',
    async enter(params = {}, from) {
      await ensureRuntime();
      let exp = params.exp;
      if (!exp && params.initial) {
        const tpl = ctx.params.template || 'obby';
        exp = createExperience(String(tpl), { title: t(tpl === 'obby' ? TXT.obby : TXT.untitled) });
      }
      if (!exp) exp = createExperience('baseplate');
      await runtime.start(exp, { from: params.from || from, test: !!params.test, id: params.id || null, key: params.key || null, creator: params.creator || '', countPlay: params.countPlay !== false });
      events.emit('studio:play', { title: exp.meta.title, test: !!params.test });
    },
    exit() {
      runtime?.stop();
    },
    update(dt) {
      runtime?.update(dt);
    },
  };
  modes.register('studio', studioMode);
  modes.register('experience', expMode);

  // --------------------------------------------------------- drafts
  function newDraft(template = 'baseplate', announce = true) {
    const title = t(template === 'obby' ? TXT.obby : TXT.untitled);
    editor.load(createExperience(template, { title }), {});
    editor.save();
    if (announce) ctx.audio?.play?.('ui.open', { volume: 0.5 });
  }
  async function loadDraft(id) {
    const local = store.load(id);
    if (local) {
      editor.load(local, { draftId: id, cloudId: store.entry(id)?.cloudId || null });
      return;
    }
    // a cloud experience id (Home → Edit)
    await openCloud(id);
  }
  async function openCloud(cloudId, title = '') {
    const known = store.list().find((e) => e.cloudId === cloudId);
    try {
      if (!store.cloud.available()) throw Object.assign(new Error('signed out'), { code: 'offline' });
      const raw = await store.cloud.get(cloudId, { draft: true });
      const r = validate(raw);
      if (!r.ok) throw new Error(r.errors[0]);
      if (title && !r.exp.meta.title) r.exp.meta.title = title;
      editor.load(r.exp, { draftId: known?.id || null, cloudId });
      editor.save();
    } catch (err) {
      const local = known ? store.load(known.id) : null;
      if (local) {
        editor.load(local, { draftId: known.id, cloudId });
        ui.toast({ title: t(TXT.offline), kind: 'warn', icon: 'info' });
      } else throw err;
    }
  }

  // ------------------------------------------------------------ API
  const api = {
    available: true,
    open(draftId = null, { from = null, template = null } = {}) {
      return modes.go('studio', { draftId: draftId || null, template: template || null, from: from || contextOf(), start: !draftId && !template });
    },
    play(experience, { from = null, id = null, test = false, key = null, creator = '' } = {}) {
      let raw = experience;
      if (raw && typeof raw === 'object' && !raw.format && !Array.isArray(raw.parts)) raw = extractExperience(raw) || raw;
      const r = validate(raw);
      if (!r.ok) {
        ui.toast({ title: t(TXT.badExp), text: t(ERROR_TEXT[r.errors[0]] || ERROR_TEXT['not-an-object']), kind: 'error', icon: 'info' });
        return { ok: false, errors: r.errors };
      }
      const expId = id || (typeof experience === 'object' && (experience.id || experience.experience?.id)) || null;
      const src = from || contextOf();
      modes.go('experience', {
        exp: r.exp,
        from: src,
        id: expId && !store.entry(String(expId)) ? String(expId) : null, // local drafts have no platform id
        key: key || (expId ? String(expId) : null),
        creator: typeof creator === 'string' ? creator.slice(0, 40) : '',
        countPlay: src !== 'home', // Home (platform-client) counts the play itself
        test: !!test,
      });
      return { ok: true, errors: [] };
    },
    playLocal(id, { from = null } = {}) {
      const exp = store.loadPublished(id) || store.load(id);
      if (!exp) return { ok: false, errors: ['not-found'] };
      return api.play(exp, { id: null, key: String(id), from });
    },
    listLocal: () => store.listPublished(),
    drafts: () => store.list(),
    validate,
    createExperience,
    get editor() {
      return editor;
    },
    get runtime() {
      return runtime;
    },
    // ---- internal (editor / dialogs / runtime)
    newDraft: (tpl) => newDraft(tpl),
    async openDraft(id) {
      try {
        await loadDraft(id);
      } catch (err) {
        console.warn('[studio] draft failed', err);
        ui.toast({ title: t(TXT.loadFail), kind: 'error', icon: 'info' });
        dialogs.openStart({ canClose: !!editor.exp });
      }
    },
    async openCloud(id, title) {
      try {
        await openCloud(id, title);
      } catch (err) {
        console.warn('[studio] cloud draft failed', err);
        ui.toast({ title: t(TXT.loadFail), kind: 'error', icon: 'info' });
        dialogs.openStart({ canClose: !!editor.exp });
      }
    },
    playTest() {
      if (!editor?.exp) return;
      const r = validate(editor.exp);
      if (!r.ok) {
        ui.toast({ title: t(TXT.badExp), text: t(ERROR_TEXT[r.errors[0]] || ''), kind: 'error' });
        return;
      }
      modes.go('experience', { exp: r.exp, from: 'studio', test: true, id: editor.cloudId || null, key: editor.draftId, creator: ctx.platform?.user?.username || '' });
    },
    backToStudio() {
      return modes.go('studio', { resume: true });
    },
    exitStudio() {
      return goHome(studioFrom);
    },
    leaveExperience(from) {
      if (from === 'studio') return api.backToStudio();
      return goHome(from || 'title');
    },
    /** Publishes the open draft: cloud when signed in, else on this device. */
    async publish({ thumbnail = null } = {}) {
      const ed = editor;
      await ed.cloudIdle(); // a running autosave may be creating the experience right now
      await ed.save();
      if (thumbnail) store.setThumb(ed.draftId, thumbnail);
      let cloud = false;
      if (store.cloud.available()) {
        if (!ed.cloudId) {
          ed.cloudId = await store.cloud.create(ed.exp, thumbnail);
          store.update(ed.draftId, { cloudId: ed.cloudId });
          await store.cloud.publish(ed.cloudId, thumbnail);
        } else await store.cloud.publish(ed.cloudId, thumbnail, ed.exp); // saves the draft + publishes in one request
        ed.markCloudSaved();
        cloud = true;
      }
      store.publishLocal(ed.draftId, ed.exp);
      const id = cloud ? ed.cloudId : ed.draftId;
      events.emit('studio:published', { id, cloud, title: ed.exp.meta.title });
      return { cloud, id };
    },
  };
  ctx.studio = api;
  return api;
}
