/* Account auth, state sync, and live updates. */
const LS_TOKEN = "momo.token";
const LS_ACCOUNT = "momo.account";
const LS_STATE = "momo.state";
const LS_BOOT = "momo.bootstrap";

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

export class Api {
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
    const bootstrap = await Api.bootstrap();
    if (!bootstrap) throw Object.assign(new Error("offline"), { offline: true });

    const token = localStorage.getItem(LS_TOKEN) || "";
    const account = readJson(LS_ACCOUNT);
    if (!token) throw Object.assign(new Error("needs_auth"), { needsAuth: true, bootstrap });

    try {
      const { res, body } = await fetchJson("/api/auth/me", { headers: authHeaders(token) }, 6000);
      if (res.status === 401) {
        Api.clearAuth();
        throw Object.assign(new Error("needs_auth"), { needsAuth: true, bootstrap });
      }
      if (!res.ok || !body || body.ok === false) throw new Error("offline");
      const state = await Api.fetchState(token);
      return new Api(token, body.account || account, bootstrap);
    } catch (err) {
      if (err && err.needsAuth) throw err;
      const cached = Api.cachedState();
      if (cached) return new Api(token, account, bootstrap, { offline: true, cached });
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
    return new Api(body.token, body.account, bootstrap || (await Api.bootstrap()));
  }

  async state() {
    const state = await Api.fetchState(this.token);
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
      Api.clearAuth();
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
    Api.clearAuth();
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
