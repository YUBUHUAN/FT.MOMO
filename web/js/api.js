/* Account auth, state sync, and live updates.
 *
 * Two modes:
 *  - LocalApi: the original zero-dependency LAN server (/api/...).
 *  - CloudApi: a standalone Android build that talks directly to Supabase
 *    through the SECURITY DEFINER RPC functions in cloud/schema.sql.
 * The cloud config is injected as window.MOMO_CLOUD before this module loads.
 */
const LS_TOKEN = "momo.token";
const LS_ACCOUNT = "momo.account";
const LS_STATE = "momo.state";
const LS_BOOT = "momo.bootstrap";

const CLOUD = typeof window !== "undefined" ? window.MOMO_CLOUD || null : null;

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch (_) {
    return null;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {
    /* storage may be full / disabled */
  }
}

async function fetchJson(url, options = {}, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, Object.assign({ signal: controller.signal }, options));
    let body = null;
    try {
      body = await res.json();
    } catch (_) {
      body = null;
    }
    return { res, body };
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(token, extra = {}) {
  return Object.assign({ authorization: `Bearer ${token}` }, extra);
}

function engine() {
  return typeof window !== "undefined" ? window.MomoEngine : null;
}

function content() {
  return typeof window !== "undefined" ? window.MomoContent : null;
}

function actions() {
  return typeof window !== "undefined" ? window.MomoActions : null;
}

function normalizeCloudState(raw) {
  let state = raw;
  if (!state || typeof state !== "object" || !state.createdAt || !state.daily) {
    state = engine().newState(Date.now());
  }
  try { engine().normalize(state, content(), Date.now()); } catch (_) { }
  return state;
}

async function cloudRpc(name, args, timeout = 15000) {
  if (!CLOUD || !CLOUD.url || !CLOUD.key) {
    throw Object.assign(new Error("cloud_not_configured"), { offline: true });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${CLOUD.url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: CLOUD.key,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify(args || {}),
      signal: controller.signal
    });
    let body = null;
    try { body = await res.json(); } catch (_) { body = null; }
    if (res.status === 401) {
      throw Object.assign(new Error("unauthorized"), { needsAuth: true, status: 401 });
    }
    if (!res.ok) {
      const message = (body && (body.message || body.error)) || "cloud_failed";
      throw Object.assign(new Error(message), { status: res.status, body });
    }
    if (!body || typeof body !== "object") {
      throw Object.assign(new Error("cloud_bad_response"), { status: res.status });
    }
    return body;
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw Object.assign(new Error("cloud_timeout"), { offline: true });
    }
    if (err && (err.needsAuth || err.status)) throw err;
    throw Object.assign(new Error("cloud_network"), { offline: true, cause: err });
  } finally {
    clearTimeout(timer);
  }
}

class LocalApi {
  constructor(token, account, bootstrap, options = {}) {
    this.token = token;
    this.account = account || null;
    this.bootstrap = bootstrap || null;
    this.offline = !!options.offline;
    this.sid = options.sid || this.makeSid();
    this.cached = options.cached || null;
    this.es = null;
  }

  makeSid() {
    let sid = localStorage.getItem("momo.sid");
    if (!sid) {
      sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem("momo.sid", sid);
    }
    return sid;
  }

  saveState(state) {
    writeJson(LS_STATE, state);
  }

  static cachedState() {
    return readJson(LS_STATE);
  }

  static clearAuth() {
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_ACCOUNT);
    localStorage.removeItem(LS_STATE);
  }

  static async bootstrap() {
    try {
      const { res, body } = await fetchJson("/api/bootstrap", {}, 6000);
      if (res.ok && body) {
        writeJson(LS_BOOT, body);
        return body;
      }
    } catch (_) {
      /* fall through to cached bootstrap */
    }
    return readJson(LS_BOOT);
  }

  static async boot() {
    const bootstrap = await LocalApi.bootstrap();
    if (!bootstrap) throw Object.assign(new Error("offline"), { offline: true });

    const token = localStorage.getItem(LS_TOKEN) || "";
    const account = readJson(LS_ACCOUNT);
    if (!token) throw Object.assign(new Error("needs_auth"), { needsAuth: true, bootstrap });

    try {
      const { res, body } = await fetchJson("/api/auth/me", { headers: authHeaders(token) }, 6000);
      if (res.status === 401) {
        LocalApi.clearAuth();
        throw Object.assign(new Error("needs_auth"), { needsAuth: true, bootstrap });
      }
      if (!res.ok || !body || body.ok === false) throw new Error("offline");
      const state = await LocalApi.fetchState(token);
      return new LocalApi(token, body.account || account, bootstrap);
    } catch (err) {
      if (err && err.needsAuth) throw err;
      const cached = LocalApi.cachedState();
      if (cached) return new LocalApi(token, account, bootstrap, { offline: true, cached });
      throw Object.assign(new Error("offline"), { offline: true, bootstrap });
    }
  }

  static async fetchState(token) {
    const { res, body } = await fetchJson("/api/state", { headers: authHeaders(token) });
    if (res.status === 401) throw Object.assign(new Error("unauthorized"), { needsAuth: true, status: 401 });
    if (!res.ok || !body || body.ok === false) {
      throw Object.assign(new Error("state_failed"), { status: res.status, body });
    }
    writeJson(LS_STATE, body.state);
    return body.state;
  }

  static async auth(username, password, mode = "login", bootstrap = null) {
    const path = mode === "register" ? "/api/auth/register" : "/api/auth/login";
    const { res, body } = await fetchJson(
      path,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password })
      },
      10000
    );
    if (!body) throw Object.assign(new Error("network"), { offline: true });
    if (!res.ok || body.ok === false) {
      const err = new Error((body && body.error) || "auth_failed");
      err.status = res.status;
      throw err;
    }
    localStorage.setItem(LS_TOKEN, body.token);
    writeJson(LS_ACCOUNT, body.account);
    writeJson(LS_STATE, body.state);
    return new LocalApi(body.token, body.account, bootstrap || (await LocalApi.bootstrap()));
  }

  async state() {
    const state = await LocalApi.fetchState(this.token);
    this.offline = false;
    this.saveState(state);
    return state;
  }

  async action(type, payload = {}, timeout = 9000) {
    const { res, body } = await fetchJson(
      "/api/action",
      {
        method: "POST",
        headers: authHeaders(this.token, { "content-type": "application/json" }),
        body: JSON.stringify({ sid: this.sid, action: Object.assign({ type }, payload) })
      },
      timeout
    );
    if (!body) throw Object.assign(new Error("network"), { offline: true });
    if (res.status === 401) {
      LocalApi.clearAuth();
      throw Object.assign(new Error("unauthorized"), { needsAuth: true, status: 401 });
    }
    if (!res.ok || body.ok === false) {
      const reason = (body.result && body.result.error) || (body && body.error) || "action_failed";
      throw Object.assign(new Error(reason), { status: res.status, body });
    }
    this.offline = false;
    this.saveState(body.state);
    return body;
  }

  async friendCode() {
    const { res, body } = await fetchJson("/api/friend/code", { headers: authHeaders(this.token) });
    if (!body) throw Object.assign(new Error("network"), { offline: true });
    if (!res.ok || body.ok === false) throw Object.assign(new Error(body.error || "friend_failed"), { status: res.status, body });
    return body;
  }

  async friendPending() {
    const { res, body } = await fetchJson("/api/friend/pending", { headers: authHeaders(this.token) });
    if (!body) throw Object.assign(new Error("network"), { offline: true });
    if (!res.ok || body.ok === false) throw Object.assign(new Error(body.error || "friend_failed"), { status: res.status, body });
    return body;
  }

  async friendStatus() {
    const { res, body } = await fetchJson("/api/friend/status", { headers: authHeaders(this.token) });
    if (!body) throw Object.assign(new Error("network"), { offline: true });
    if (!res.ok || body.ok === false) throw Object.assign(new Error(body.error || "friend_failed"), { status: res.status, body });
    return body;
  }

  async friendRequest(code) {
    const { res, body } = await fetchJson("/api/friend/request", {
      method: "POST",
      headers: authHeaders(this.token, { "content-type": "application/json" }),
      body: JSON.stringify({ code })
    });
    if (!body) throw Object.assign(new Error("network"), { offline: true });
    if (!res.ok || body.ok === false) throw Object.assign(new Error(body.error || "friend_failed"), { status: res.status, body });
    return body;
  }

  async friendFeed(foodId) {
    const { res, body } = await fetchJson("/api/friend/feed", {
      method: "POST", headers: authHeaders(this.token, { "content-type": "application/json" }),
      body: JSON.stringify({ foodId })
    });
    if (!res.ok || body.ok === false) throw Object.assign(new Error(body.error || "friend_failed"), { status: res.status, body });
    return body;
  }

  async friendActivityRequest(kind, option) {
    const { res, body } = await fetchJson("/api/friend/activity/request", {
      method: "POST", headers: authHeaders(this.token, { "content-type": "application/json" }),
      body: JSON.stringify({ kind, option })
    });
    if (!res.ok || body.ok === false) throw Object.assign(new Error(body.error || "friend_failed"), { status: res.status, body });
    return body;
  }

  async friendActivityRespond(id, accept) {
    const { res, body } = await fetchJson("/api/friend/activity/respond", {
      method: "POST", headers: authHeaders(this.token, { "content-type": "application/json" }),
      body: JSON.stringify({ id, accept })
    });
    if (!res.ok || body.ok === false) throw Object.assign(new Error(body.error || "friend_failed"), { status: res.status, body });
    return body;
  }

  async friendActivityCancel(id) {
    const { res, body } = await fetchJson("/api/friend/activity/cancel", {
      method: "POST", headers: authHeaders(this.token, { "content-type": "application/json" }),
      body: JSON.stringify({ id })
    });
    if (!res.ok || body.ok === false) throw Object.assign(new Error(body.error || "friend_failed"), { status: res.status, body });
    return body;
  }

  async friendEvents() {
    const { res, body } = await fetchJson("/api/friend/events", { headers: authHeaders(this.token) });
    if (!res.ok || body.ok === false) throw Object.assign(new Error(body.error || "friend_failed"), { status: res.status, body });
    return body;
  }

  async friendEventAck(id) {
    const { res, body } = await fetchJson("/api/friend/events/ack", {
      method: "POST", headers: authHeaders(this.token, { "content-type": "application/json" }),
      body: JSON.stringify({ id })
    });
    if (!res.ok || body.ok === false) throw Object.assign(new Error(body.error || "friend_failed"), { status: res.status, body });
    return body;
  }

  async friendUnbind() {
    const { res, body } = await fetchJson("/api/friend/unbind", {
      method: "POST",
      headers: authHeaders(this.token, { "content-type": "application/json" }),
      body: "{}"
    });
    if (!body) throw Object.assign(new Error("network"), { offline: true });
    if (!res.ok || body.ok === false) throw Object.assign(new Error(body.error || "friend_failed"), { status: res.status, body });
    return body;
  }

  async heartbeat(visible) {
    try {
      return await this.action("heartbeat", { visible: !!visible }, 6000);
    } catch (_) {
      return null;
    }
  }

  connect(handlers = {}) {
    if (this.offline) return;
    if (this.es) this.es.close();
    const es = new EventSource(`/api/events?token=${encodeURIComponent(this.token)}`);
    this.es = es;
    es.addEventListener("state", (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data && data.state) {
          this.saveState(data.state);
          if (handlers.onState) handlers.onState(data.state, data);
        }
      } catch (_) {
        /* ignore malformed frame */
      }
    });
    es.onopen = () => {
      this.offline = false;
      if (handlers.onStatus) handlers.onStatus(true);
    };
    es.onerror = () => {
      if (handlers.onStatus) handlers.onStatus(false);
    };
    return es;
  }

  disconnect() {
    if (this.es) this.es.close();
    this.es = null;
  }

  async logout() {
    try {
      await fetchJson("/api/auth/logout", { method: "POST", headers: authHeaders(this.token) }, 5000);
    } catch (_) {
      /* local logout still wins */
    }
    LocalApi.clearAuth();
    this.disconnect();
  }

  get accountName() {
    return (this.account && this.account.username) || "";
  }

  get urls() {
    return (this.bootstrap && this.bootstrap.urls) || [];
  }

  get serverUrl() {
    return location.origin;
  }
}

class CloudApi {
  constructor(token, account, bootstrap, options = {}) {
    this.token = token;
    this.account = account || null;
    this.bootstrap = bootstrap || null;
    this.offline = !!options.offline;
    this.cached = options.cached || null;
    this.stateValue = options.state || null;
    this.rev = Number(options.rev || 0);
    this.sid = options.sid || this.makeSid();
    this.timer = null;
    this.polling = false;
  }

  makeSid() {
    let sid = localStorage.getItem("momo.sid");
    if (!sid) {
      sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem("momo.sid", sid);
    }
    return sid;
  }

  saveState(state) {
    this.stateValue = state;
    writeJson(LS_STATE, state);
  }

  static clearAuth() {
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_ACCOUNT);
    localStorage.removeItem(LS_STATE);
  }

  static cachedState() {
    return readJson(LS_STATE);
  }

  static async bootstrap() {
    return {
      version: content()?.VERSION || "cloud",
      needsAuth: true,
      cloud: true,
      serverName: "墨墨 · 云同步",
      urls: []
    };
  }

  static async fetchState(token) {
    const out = await cloudRpc("momo_get_state", { p_token: token });
    if (!out || out.ok === false) {
      if (out && out.error === "unauthorized") {
        throw Object.assign(new Error("unauthorized"), { needsAuth: true, status: 401 });
      }
      throw Object.assign(new Error(out?.error || "state_failed"), { status: 200, body: out });
    }
    const state = normalizeCloudState(out.state);
    writeJson(LS_STATE, state);
    return { state, rev: Number(out.rev || 0) };
  }

  static async boot() {
    const bootstrap = await CloudApi.bootstrap();
    const token = localStorage.getItem(LS_TOKEN) || "";
    const account = readJson(LS_ACCOUNT);
    if (!token) throw Object.assign(new Error("needs_auth"), { needsAuth: true, bootstrap });

    try {
      const me = await cloudRpc("momo_me", { p_token: token }, 10000);
      if (!me || me.ok === false) {
        CloudApi.clearAuth();
        throw Object.assign(new Error("needs_auth"), { needsAuth: true, bootstrap });
      }
      const fetched = await CloudApi.fetchState(token);
      return new CloudApi(token, me.account || account, bootstrap, {
        state: fetched.state,
        rev: fetched.rev
      });
    } catch (err) {
      if (err && err.needsAuth) throw err;
      const cached = readJson(LS_STATE);
      if (cached) {
        return new CloudApi(token, account, bootstrap, { offline: true, cached, state: cached });
      }
      throw Object.assign(new Error("offline"), { offline: true, bootstrap });
    }
  }

  static async auth(username, password, mode = "login", bootstrap = null) {
    const fn = mode === "register" ? "momo_register" : "momo_login";
    const out = await cloudRpc(fn, { p_username: username, p_password: password }, 15000);
    if (!out || out.ok === false) {
      const err = new Error((out && out.error) || "auth_failed");
      err.status = 200;
      throw err;
    }
    localStorage.setItem(LS_TOKEN, out.token);
    writeJson(LS_ACCOUNT, out.account);
    const state = normalizeCloudState(out.state);
    writeJson(LS_STATE, state);
    return new CloudApi(out.token, out.account, bootstrap || (await CloudApi.bootstrap()), {
      state,
      rev: Number(out.rev || 0)
    });
  }

  async state() {
    const fetched = await CloudApi.fetchState(this.token);
    this.saveState(fetched.state);
    this.rev = fetched.rev;
    this.offline = false;
    return fetched.state;
  }

  async action(type, payload = {}, timeout = 12000) {
    const act = Object.assign({ type }, payload);
    const engineRef = engine();
    const contentRef = content();
    const actionsRef = actions();

    for (let attempt = 0; attempt < 3; attempt++) {
      if (!this.stateValue) {
        const fetched = await CloudApi.fetchState(this.token);
        this.saveState(fetched.state);
        this.rev = fetched.rev;
      }
      const now = Date.now();
      const state = this.stateValue;
      let events = [];
      try { events = engineRef.normalize(state, contentRef, now) || []; } catch (_) { events = []; }
      const result = actionsRef.applyAction(state, contentRef, act, now);
      if (!result.ok) {
        return { ok: false, result, state, error: result.error || "action_failed" };
      }
      const saved = await cloudRpc("momo_save_state", {
        p_token: this.token,
        p_state: state,
        p_base_rev: this.rev
      }, timeout);
      if (saved && saved.ok === false) {
        if (saved.error === "conflict" && saved.state) {
          this.saveState(normalizeCloudState(saved.state));
          this.rev = Number(saved.rev || 0);
          continue;
        }
        if (saved.error === "unauthorized") {
          CloudApi.clearAuth();
          throw Object.assign(new Error("unauthorized"), { needsAuth: true, status: 401 });
        }
        throw Object.assign(new Error(saved.error || "save_failed"), { status: 200, body: saved });
      }
      this.saveState(saved.state || state);
      this.rev = Number(saved.rev || this.rev + 1);
      this.offline = false;
      return { ok: true, result, state: this.stateValue, events, now: new Date(now).toISOString() };
    }
    throw Object.assign(new Error("conflict"), { status: 409 });
  }

  async friendCode() {
    return cloudRpc("friend_code_for", { p_token: this.token });
  }

  async friendPending() {
    return cloudRpc("friend_pending", { p_token: this.token });
  }

  async friendStatus() {
    return cloudRpc("friend_status", { p_token: this.token });
  }

  async friendRequest(code) {
    return cloudRpc("friend_request", { p_token: this.token, p_code: code });
  }

  async friendUnbind() {
    return cloudRpc("friend_unbind", { p_token: this.token });
  }

  async friendFeed(foodId) {
    return cloudRpc("friend_feed", { p_token: this.token, p_food_id: foodId });
  }

  async friendActivityRequest(kind, option) {
    return cloudRpc("friend_activity_request", { p_token: this.token, p_kind: kind, p_option: option });
  }

  async friendActivityRespond(id, accept) {
    return cloudRpc("friend_activity_respond", { p_token: this.token, p_id: id, p_accept: !!accept });
  }

  async friendActivityCancel(id) {
    return cloudRpc("friend_activity_cancel", { p_token: this.token, p_id: id });
  }

  async friendEvents() {
    return cloudRpc("friend_events", { p_token: this.token });
  }

  async friendEventAck(id) {
    return cloudRpc("friend_event_ack", { p_token: this.token, p_id: id });
  }

  async heartbeat(visible) {
    try {
      return await this.action("heartbeat", { visible: !!visible }, 8000);
    } catch (_) {
      return null;
    }
  }

  connect(handlers = {}) {
    this.disconnect();
    if (this.offline && handlers.onStatus) handlers.onStatus(false);
    const tick = async () => {
      if (this.polling) return;
      this.polling = true;
      try {
        const fetched = await CloudApi.fetchState(this.token);
        this.offline = false;
        if (handlers.onStatus) handlers.onStatus(true);
        if (fetched.rev !== this.rev || !this.stateValue) {
          this.rev = fetched.rev;
          this.saveState(fetched.state);
          if (handlers.onState) handlers.onState(fetched.state, { rev: fetched.rev });
        }
      } catch (err) {
        if (err && err.needsAuth) {
          if (handlers.onStatus) handlers.onStatus(false);
          this.disconnect();
          return;
        }
        this.offline = true;
        if (handlers.onStatus) handlers.onStatus(false);
      } finally {
        this.polling = false;
      }
    };
    this.timer = setInterval(tick, 4000);
    tick();
    return this.timer;
  }

  disconnect() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async logout() {
    try { await cloudRpc("momo_logout", { p_token: this.token }, 6000); } catch (_) { }
    CloudApi.clearAuth();
    this.disconnect();
  }

  get accountName() {
    return (this.account && this.account.username) || "";
  }

  get urls() {
    return [];
  }

  get serverUrl() {
    return "cloud";
  }
}

export const Api = CLOUD ? CloudApi : LocalApi;
