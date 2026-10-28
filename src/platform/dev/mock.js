/**
 * Dev-only in-page mock of the platform API (PLATFORM.md §10), loaded with
 * `?mockapi` (dynamic import — never part of the normal flow). Same routes,
 * same JSON shapes as the contract, a few seeded creators/experiences, and
 * in-memory state (kept in sessionStorage unless ?nosave) so UI work and
 * screenshots don't need a running server. Returns a fetch-compatible function.
 */
const SEED_USERS = [
  { username: 'nova_builds', online: true, activity: 'Sky Islands Obby' },
  { username: 'kai', online: true, activity: 'Ø Universe — SMP' },
  { username: 'luna_o', online: false },
  { username: 'oran_trades', online: false },
  { username: 'milan_42', online: true, activity: 'Ø Studio' },
];
const SEED_EXPERIENCES = [
  ['Sky Islands Obby', 'nova_builds', 'Leap across floating rock islands above the lake. 40 stages, checkpoints every 5.', 'golden', 1840, 46200],
  ['Neon Night Racer', 'milan_42', 'Drift through a glowing city circuit at night. Beat the ghost of the fastest lap.', 'night', 920, 21800],
  ['Glass House Hangout', 'luna_o', 'A calm place to meet friends: fire pit, music stage and a view over the pines.', 'golden', 610, 15400],
  ['Lumen Maze', 'kai', 'Find your way through a bioluminescent hedge maze before the lights go out.', 'night', 455, 9800],
  ['Orbital Parkour', 'nova_builds', 'Low gravity parkour on a station ring high above the planet.', 'space', 1220, 30900],
  ['Ruins Escape', 'oran_trades', 'Solve the old inscriptions and escape the collapsing ruins.', 'day', 330, 7100],
  ['Tower Builders Lab', 'milan_42', 'Stack, balance and decorate — the tallest tower of the week wins.', 'day', 210, 4300],
  ['Sunset Lookout', 'luna_o', 'Climb the old lookout and watch the sun set behind Aurora City.', 'golden', 145, 2600],
];

const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const err = (status, code, message = code) => json(status, { error: code, message });
const rid = (p) => `${p}${Math.random().toString(36).slice(2, 10)}`;

export function createMockFetch({ persist = true, latency = 120 } = {}) {
  const KEY = 'o-universe-mockapi';
  let db = null;
  try {
    if (persist) db = JSON.parse(sessionStorage.getItem(KEY) || 'null');
  } catch {
    db = null;
  }
  if (!db) db = seed();
  const save = () => {
    try {
      if (persist) sessionStorage.setItem(KEY, JSON.stringify(db));
    } catch {
      /* ignore */
    }
  };

  function seed() {
    const d = { users: {}, sessions: {}, friends: [], experiences: {}, likes: {}, reports: [] };
    for (const u of SEED_USERS) d.users[u.username] = { id: rid('u'), username: u.username, password: 'x', birthYear: 1998, online: u.online, activity: u.activity || '', createdAt: Date.now() - 9e9 };
    SEED_EXPERIENCES.forEach(([title, creator, description, sky, likes, plays], i) => {
      const id = `exp-${i + 1}`;
      d.experiences[id] = {
        id,
        title,
        description,
        creator,
        likes,
        plays,
        published: true,
        publishedAt: Date.now() - (i + 1) * 86400000 * (i % 3 ? 3 : 1),
        updatedAt: Date.now() - (i + 1) * 3600000 * 7,
        createdAt: Date.now() - 30 * 86400000,
        maxPlayers: 20,
        data: { format: 'o-universe-experience', v: 1, meta: { title, description, maxPlayers: 20 }, settings: { time: 17.6, sky, gravity: 1, baseplate: { size: 512, color: '#3a3f47', material: 'concrete' } }, parts: [], groups: [], logic: [] },
      };
    });
    return d;
  }

  const pub = (u) => (u ? { id: u.id, username: u.username, displayName: u.username, birthYear: u.birthYear, under13: new Date().getFullYear() - u.birthYear < 13, createdAt: u.createdAt } : null);
  const userByToken = (req) => {
    const m = /^Bearer (.+)$/.exec(req.headers.Authorization || req.headers.authorization || '');
    const name = m && db.sessions[m[1]];
    return name ? db.users[name] : null;
  };
  const meta = (x, me) => {
    const { data, ...rest } = x;
    return { ...rest, liked: !!(me && db.likes[`${x.id}|${me.username}`]) };
  };
  const friendView = (me) => {
    const friends = [];
    const incoming = [];
    const outgoing = [];
    for (const f of db.friends) {
      if (f.a !== me.username && f.b !== me.username) continue;
      const other = db.users[f.a === me.username ? f.b : f.a];
      if (!other) continue;
      const item = { id: f.id, user: { id: other.id, username: other.username }, online: f.state === 'accepted' && !!other.online, activity: other.online ? other.activity : '' };
      if (f.state === 'accepted') friends.push(item);
      else if (f.b === me.username) incoming.push(item);
      else outgoing.push(item);
    }
    return { friends, incoming, outgoing };
  };

  async function route(method, path, query, body, req) {
    const me = userByToken(req);
    let m;
    if (method === 'POST' && path === '/api/auth/register') {
      const username = String(body.username || '').toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(username)) return err(400, 'invalid_username');
      if (/admin|moderator|badword/.test(username)) return err(400, 'username_filtered');
      if (db.users[username]) return err(409, 'username_taken');
      if (String(body.password || '').length < 8) return err(400, 'password_too_short');
      const by = Number(body.birthYear);
      if (!Number.isInteger(by) || by < 1900 || by > new Date().getFullYear()) return err(400, 'invalid_birth_year');
      const u = { id: rid('u'), username, password: body.password, birthYear: by, createdAt: Date.now(), linkedGuest: body.guestToken ? String(body.guestToken).slice(0, 6) : null };
      db.users[username] = u;
      const token = rid('t') + rid('');
      db.sessions[token] = username;
      if (new Date().getFullYear() - by >= 13) {
        db.friends.push({ id: rid('f'), a: 'kai', b: username, state: 'accepted' });
        db.friends.push({ id: rid('f'), a: 'nova_builds', b: username, state: 'pending' });
      }
      save();
      return json(201, { token, user: pub(u) });
    }
    if (method === 'POST' && path === '/api/auth/login') {
      const u = db.users[String(body.username || '').toLowerCase()];
      if (!u || u.password !== body.password) return err(401, 'invalid_credentials');
      const token = rid('t') + rid('');
      db.sessions[token] = u.username;
      save();
      return json(200, { token, user: pub(u) });
    }
    if (method === 'POST' && path === '/api/auth/logout') {
      const tk = /^Bearer (.+)$/.exec(req.headers.Authorization || '')?.[1];
      if (tk) delete db.sessions[tk];
      save();
      return json(200, { ok: true });
    }
    if (method === 'GET' && path === '/api/me') return me ? json(200, { user: pub(me) }) : err(401, 'unauthorized');
    if (path.startsWith('/api/friends')) {
      if (!me) return err(401, 'unauthorized');
      const under13 = new Date().getFullYear() - me.birthYear < 13;
      if (method === 'GET' && path === '/api/friends') return json(200, friendView(me));
      if (under13) return err(403, 'friends_restricted');
      if (method === 'POST' && path === '/api/friends/request') {
        const other = db.users[String(body.username || '').toLowerCase()];
        if (!other) return err(404, 'user_not_found');
        if (other.username === me.username) return err(400, 'cannot_add_self');
        const ex = db.friends.find((f) => (f.a === me.username && f.b === other.username) || (f.b === me.username && f.a === other.username));
        if (ex) return err(409, ex.state === 'accepted' ? 'already_friends' : 'request_pending');
        db.friends.push({ id: rid('f'), a: me.username, b: other.username, state: 'pending' });
        save();
        return json(200, { ok: true, ...friendView(me) });
      }
      if (method === 'POST' && (path === '/api/friends/accept' || path === '/api/friends/remove')) {
        const i = db.friends.findIndex((f) => f.id === body.id && (f.a === me.username || f.b === me.username));
        if (i < 0) return err(404, 'not_found');
        if (path.endsWith('accept')) db.friends[i].state = 'accepted';
        else db.friends.splice(i, 1);
        save();
        return json(200, { ok: true, ...friendView(me) });
      }
    }
    if (method === 'GET' && path === '/api/experiences') {
      let list = Object.values(db.experiences).filter((x) => x.published);
      const q = String(query.get('q') || '').toLowerCase();
      if (q) list = list.filter((x) => x.title.toLowerCase().includes(q) || x.creator.includes(q));
      list.sort(query.get('sort') === 'new' ? (a, b) => b.publishedAt - a.publishedAt : (a, b) => b.plays + b.likes * 20 - (a.plays + a.likes * 20));
      return json(200, { experiences: list.slice(0, 30).map((x) => meta(x, me)) });
    }
    if ((m = /^\/api\/users\/([a-z0-9_]+)\/experiences$/.exec(path)) && method === 'GET') {
      const own = me && me.username === m[1];
      const list = Object.values(db.experiences).filter((x) => x.creator === m[1] && (x.published || own));
      return json(200, { experiences: list.map((x) => meta(x, me)) });
    }
    if (method === 'POST' && path === '/api/experiences') {
      if (!me) return err(401, 'unauthorized');
      const id = rid('exp-');
      const title = String(body.title || body.meta?.title || 'Untitled').slice(0, 60);
      db.experiences[id] = { id, title, description: '', creator: me.username, likes: 0, plays: 0, published: false, createdAt: Date.now(), updatedAt: Date.now(), data: body.data || body };
      save();
      return json(201, { experience: meta(db.experiences[id], me) });
    }
    if ((m = /^\/api\/experiences\/([\w-]+)(?:\/(\w+))?$/.exec(path))) {
      const x = db.experiences[m[1]];
      if (!x) return err(404, 'not_found');
      const action = m[2];
      if (!action && method === 'GET') return json(200, { experience: meta(x, me), version: x.published ? { v: 1, data: x.data, publishedAt: x.publishedAt } : null });
      if (!me && action !== 'play') return err(401, 'unauthorized');
      if (action === 'like' && method === 'POST') {
        const k = `${x.id}|${me.username}`;
        if (db.likes[k]) {
          delete db.likes[k];
          x.likes = Math.max(0, x.likes - 1);
        } else {
          db.likes[k] = true;
          x.likes++;
        }
        save();
        return json(200, { liked: !!db.likes[k], likes: x.likes });
      }
      if (action === 'play' && method === 'POST') {
        x.plays++;
        save();
        return json(200, { plays: x.plays });
      }
      if (x.creator !== me.username) return err(403, 'forbidden');
      if (!action && method === 'PUT') {
        Object.assign(x, { title: String(body.meta?.title || body.title || x.title).slice(0, 60), description: String(body.meta?.description || body.description || x.description), data: body.data || body, updatedAt: Date.now() });
        save();
        return json(200, { experience: meta(x, me) });
      }
      if (action === 'publish' && method === 'POST') {
        Object.assign(x, { published: true, publishedAt: Date.now() });
        save();
        return json(200, { experience: meta(x, me) });
      }
      if (!action && method === 'DELETE') {
        delete db.experiences[x.id];
        save();
        return json(200, { ok: true });
      }
    }
    if (method === 'POST' && path === '/api/report') {
      if (!body.kind || !body.targetId) return err(400, 'invalid_report');
      db.reports.push({ ...body, by: me?.username || 'guest', at: Date.now() });
      save();
      return json(200, { ok: true });
    }
    return err(404, 'not_found');
  }

  return async function mockFetch(url, init = {}) {
    await new Promise((r) => setTimeout(r, latency));
    const u = new URL(url, location.origin);
    let body = {};
    try {
      body = init.body ? JSON.parse(init.body) : {};
    } catch {
      return err(400, 'bad_json');
    }
    return route(String(init.method || 'GET').toUpperCase(), u.pathname, u.searchParams, body, { headers: init.headers || {} });
  };
}
