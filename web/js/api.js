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

function letterFailure(body, status, fallback = "letter_failed") {
  const code = (body && typeof body === "object" && (body.error || body.code)) || fallback;
  const err = new Error(String(code));
  err.code = String(code);
  err.status = Number(status) || 0;
  err.body = body && typeof body === "object" ? body : null;
  if (err.status === 401 || err.code === "unauthorized") err.needsAuth = true;
  return err;
}

async function cloudLetterRpc(name, args) {
  try {
    const body = await cloudRpc(name, args);
    if (!body || body.ok === false) {
      throw letterFailure(body, 200, "letter_failed");
    }
    return body;
  } catch (err) {
    if (err && err.needsAuth) {
      if (!err.code) err.code = "unauthorized";
      if (!("body" in err)) err.body = null;
      throw err;
    }
    if (err && err.offline) {
      if (!err.code) err.code = err.message === "cloud_timeout" ? "cloud_timeout" : "cloud_network";
      err.status = Number(err.status) || 0;
      if (!("body" in err)) err.body = null;
      throw err;
    }
    const status = Number(err && err.status) || 0;
    if (status === 408) {
      const timeout = letterFailure({ error: "cloud_timeout" }, 408, "cloud_timeout");
      timeout.offline = true;
      throw timeout;
    }
    if (status === 403) throw letterFailure({ error: "forbidden" }, 403, "forbidden");
    if (status === 404) throw letterFailure({ error: "not_found" }, 404, "not_found");
    if (status === 409) throw letterFailure({ error: "conflict" }, 409, "conflict");
    if (status === 429) throw letterFailure({ error: "rate_limited" }, 429, "rate_limited");
    if (status >= 400 && status < 500) {
      throw letterFailure({ error: "bad_request" }, status, "bad_request");
    }
    if (status >= 500) {
      const offline = letterFailure({ error: "cloud_offline" }, 503, "cloud_offline");
      offline.offline = true;
      throw offline;
    }
    throw err;
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

  static clearAuthOnly() {
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_ACCOUNT);
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

  async friendHistory(limit = 20) {
    const { res, body } = await fetchJson(`/api/friend/history?limit=${encodeURIComponent(limit)}`, { headers: authHeaders(this.token) });
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

  async _letterFetch(path, options = {}) {
    let result;
    try {
      result = await fetchJson(path, options);
    } catch (err) {
      if (err && err.name === "AbortError") {
        const timeout = letterFailure({ error: "cloud_timeout" }, 0, "cloud_timeout");
        timeout.offline = true;
        throw timeout;
      }
      if (err && err.offline) throw err;
      const network = letterFailure({ error: "network" }, 0, "network");
      network.offline = true;
      throw network;
    }
    const { res, body } = result;
    if (res.status === 401) {
      LocalApi.clearAuth();
      const unauthorized = letterFailure({ error: "unauthorized" }, 401);
      unauthorized.needsAuth = true;
      throw unauthorized;
    }
    if (res.status === 408) {
      const timeout = letterFailure({ error: "cloud_timeout" }, 408, "cloud_timeout");
      timeout.offline = true;
      throw timeout;
    }
    if (res.status >= 500) {
      const code = body && body.error === "cloud_timeout" ? "cloud_timeout" : "cloud_offline";
      const offline = letterFailure({ error: code }, res.status, code);
      offline.offline = true;
      throw offline;
    }
    if (!body) {
      const offline = letterFailure({ error: "cloud_offline" }, 0, "network");
      offline.offline = true;
      throw offline;
    }
    if (res.status >= 400) {
      const fallback = res.status === 429 ? "rate_limited"
        : res.status === 403 ? "forbidden"
        : res.status === 404 ? "not_found"
        : res.status === 409 ? "conflict"
        : "bad_request";
      if (body.ok === false) {
        const failure = letterFailure(body, res.status, fallback);
        if (failure.needsAuth) LocalApi.clearAuth();
        throw failure;
      }
      throw letterFailure({ error: fallback }, res.status, fallback);
    }
    if (body.ok === false) {
      const failure = letterFailure(body, res.status);
      if (failure.needsAuth) LocalApi.clearAuth();
      throw failure;
    }
    return body;
  }

  async letterSend(style, body, paperStyle, envelopeStyle, sticker, replyTo, clientToken) {
    if (!clientToken) throw letterFailure({ error: "bad_client_token" }, 400, "bad_client_token");
    return this._letterFetch("/api/friend/letters/send", {
      method: "POST",
      headers: authHeaders(this.token, { "content-type": "application/json" }),
      body: JSON.stringify({
        style,
        body,
        paperStyle,
        envelopeStyle,
        sticker: sticker || null,
        replyTo: replyTo || null,
        clientToken
      })
    });
  }

  async letterList(box = "inbox", limit = 20, before = null, beforeId = null) {
    if (!!before !== !!beforeId) throw letterFailure({ error: "bad_cursor" }, 400, "bad_cursor");
    const params = new URLSearchParams({ box: box || "inbox", limit: String(limit == null ? 20 : limit) });
    if (before) params.set("before", before);
    if (beforeId) params.set("beforeId", beforeId);
    return this._letterFetch(`/api/friend/letters/list?${params.toString()}`, {
      headers: authHeaders(this.token)
    });
  }

  async letterGet(id) {
    return this._letterFetch(`/api/friend/letters/get?id=${encodeURIComponent(id)}`, {
      headers: authHeaders(this.token)
    });
  }

  async letterRead(id) {
    return this._letterFetch("/api/friend/letters/read", {
      method: "POST",
      headers: authHeaders(this.token, { "content-type": "application/json" }),
      body: JSON.stringify({ id })
    });
  }

  async letterReact(id, kind) {
    return this._letterFetch("/api/friend/letters/react", {
      method: "POST",
      headers: authHeaders(this.token, { "content-type": "application/json" }),
      body: JSON.stringify({ id, kind })
    });
  }

  async letterUnread() {
    return this._letterFetch("/api/friend/letters/unread", {
      headers: authHeaders(this.token)
    });
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

  static clearAuthOnly() {
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_ACCOUNT);
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
        CloudApi.clearAuthOnly();
        throw Object.assign(new Error("needs_auth"), { needsAuth: true, bootstrap });
      }
      const fetched = await CloudApi.fetchState(token);
      return new CloudApi(token, me.account || account, bootstrap, {
        state: fetched.state,
        rev: fetched.rev
      });
    } catch (err) {
      if (err && err.needsAuth) {
        CloudApi.clearAuthOnly();
        throw err;
      }
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
    const body = await cloudRpc("friend_unbind", { p_token: this.token });
    if (!body || body.ok === false) {
      const code = (body && (body.error || body.code)) || "friend_failed";
      throw Object.assign(new Error(code), {
        code,
        status: 200,
        body: body || null
      });
    }
    return body;
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

  async friendHistory(limit = 20) {
    return cloudRpc("friend_history", { p_token: this.token, p_limit: limit });
  }

  async friendEventAck(id) {
    return cloudRpc("friend_event_ack", { p_token: this.token, p_id: id });
  }

  async letterSend(style, body, paperStyle, envelopeStyle, sticker, replyTo, clientToken) {
    if (!clientToken) throw letterFailure({ error: "bad_client_token" }, 400, "bad_client_token");
    return cloudLetterRpc("friend_letter_send", {
      p_token: this.token,
      p_style: style,
      p_body: body,
      p_paper_style: paperStyle,
      p_envelope_style: envelopeStyle,
      p_sticker: sticker || null,
      p_reply_to: replyTo || null,
      p_client_token: clientToken
    });
  }

  async letterList(box = "inbox", limit = 20, before = null, beforeId = null) {
    if (!!before !== !!beforeId) throw letterFailure({ error: "bad_cursor" }, 400, "bad_cursor");
    return cloudLetterRpc("friend_letter_list", {
      p_token: this.token,
      p_box: box || "inbox",
      p_limit: limit == null ? 20 : limit,
      p_before: before || null,
      p_before_id: beforeId || null
    });
  }

  async letterGet(id) {
    return cloudLetterRpc("friend_letter_get", { p_token: this.token, p_id: id });
  }

  async letterRead(id) {
    return cloudLetterRpc("friend_letter_read", { p_token: this.token, p_id: id });
  }

  async letterReact(id, kind) {
    return cloudLetterRpc("friend_letter_react", { p_token: this.token, p_id: id, p_kind: kind });
  }

  async letterUnread() {
    return cloudLetterRpc("friend_letter_unread", { p_token: this.token });
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
          if (handlers.onAuthRequired) handlers.onAuthRequired();
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
