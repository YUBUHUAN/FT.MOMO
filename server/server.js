/* MomoPet sync server — zero dependencies.
 * Accounts, per-account pet state, live updates over SSE, and the PWA host.
 * One computer runs this; phones on the same Wi-Fi log into the same account.
 */
"use strict";

const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const content = require("../shared/content.js");
const engine = require("../shared/engine.js");
const actions = require("../shared/actions.js");
const { createCloudBackend, loadConfig, CloudError } = require("./cloud.js");

const MAX_BODY = 64 * 1024;
const SESSION_DAYS = 30;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2"
};

const USERNAME_RE = /^[\p{L}\p{N}_-]{2,20}$/u;

function lanUrls(port) {
  const urls = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] || []) {
      if (net.family !== "IPv4" || net.internal) continue;
      urls.push({ name, ip: net.address, url: `http://${net.address}:${port}` });
    }
  }
  const rank = (u) => {
    let score = 5;
    if (u.ip.startsWith("192.168.")) score = 0;
    else if (u.ip.startsWith("10.")) score = 1;
    else if (/^172\.(1[6-9]|2\d|3[01])\./.test(u.ip)) score = 2;
    else if (u.ip.startsWith("169.254.")) score = 7;
    if (/vpn|radmin|tailscale|zerotier|vmware|virtualbox|hyper-v/i.test(u.name)) score += 10;
    return score;
  };
  urls.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return urls;
}

function isLocal(req) {
  const addr = (req.socket.remoteAddress || "").replace("::ffff:", "");
  return addr === "127.0.0.1" || addr === "::1" || addr === "localhost";
}

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const target = path.resolve(root, "." + decoded);
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return target;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString("hex");
}

function passwordMatches(password, account) {
  try {
    const actual = Buffer.from(hashPassword(password, account.salt), "hex");
    const expected = Buffer.from(account.hash, "hex");
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (_) {
    return false;
  }
}

function publicAccount(account) {
  return { id: account.id, username: account.username, createdAt: account.createdAt };
}

class AccountStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.statesDir = path.join(dataDir, "states");
    this.accountsPath = path.join(dataDir, "accounts.json");
    this.sessionsPath = path.join(dataDir, "sessions.json");
    this.accounts = [];
    this.sessions = new Map(); // token hash -> { accountId, expiresAt, createdAt }
    this.states = new Map();
    this.timers = new Map();
    this.ready = this.init();
  }

  async init() {
    await fsp.mkdir(this.statesDir, { recursive: true });
    try {
      const raw = JSON.parse(await fsp.readFile(this.accountsPath, "utf8"));
      this.accounts = Array.isArray(raw.accounts) ? raw.accounts : [];
    } catch (_) {
      this.accounts = [];
    }
    try {
      const raw = JSON.parse(await fsp.readFile(this.sessionsPath, "utf8"));
      const now = Date.now();
      for (const row of raw.sessions || []) {
        if (row && row.hash && row.accountId && row.expiresAt > now) {
          this.sessions.set(row.hash, row);
        }
      }
    } catch (_) {
      this.sessions = new Map();
    }
    if (!this.accounts.length) await this.writeAccounts();
  }

  async writeAccounts() {
    await this.writeAtomic(this.accountsPath, JSON.stringify({ accounts: this.accounts }, null, 2));
  }

  async writeSessions() {
    const now = Date.now();
    const rows = [];
    for (const [hash, row] of this.sessions) {
      if (row.expiresAt > now) rows.push(Object.assign({ hash }, row));
      else this.sessions.delete(hash);
    }
    await this.writeAtomic(this.sessionsPath, JSON.stringify({ sessions: rows }, null, 2));
  }

  findByName(username) {
    const key = String(username || "").trim().toLowerCase();
    return this.accounts.find((a) => a.key === key) || null;
  }

  findById(id) {
    return this.accounts.find((a) => a.id === id) || null;
  }

  async createAccount(username, password) {
    const name = String(username || "").trim();
    if (!USERNAME_RE.test(name)) return { ok: false, error: "bad_username" };
    if (this.findByName(name)) return { ok: false, error: "username_taken" };
    if (String(password || "").length < 6 || String(password).length > 72) {
      return { ok: false, error: "bad_password" };
    }
    const salt = crypto.randomBytes(16).toString("hex");
    const account = {
      id: "u" + crypto.randomBytes(8).toString("hex"),
      username: name,
      key: name.toLowerCase(),
      salt,
      hash: hashPassword(password, salt),
      createdAt: new Date().toISOString()
    };
    this.accounts.push(account);
    await this.writeAccounts();
    const state = engine.newState(Date.now());
    await this.saveNow(account.id, state);
    this.states.set(account.id, state);
    return { ok: true, account, state };
  }

  async verify(username, password) {
    const account = this.findByName(username);
    if (!account || !passwordMatches(password, account)) return null;
    return account;
  }

  async createSession(accountId) {
    const token = randomToken();
    const hash = tokenHash(token);
    const now = Date.now();
    this.sessions.set(hash, {
      accountId,
      createdAt: new Date(now).toISOString(),
      expiresAt: now + SESSION_DAYS * 86400000
    });
    await this.writeSessions();
    return token;
  }

  async authToken(token) {
    if (!token) return null;
    const hash = tokenHash(token);
    const row = this.sessions.get(hash);
    if (!row || row.expiresAt < Date.now()) {
      if (row) {
        this.sessions.delete(hash);
        await this.writeSessions().catch(() => {});
      }
      return null;
    }
    return this.findById(row.accountId);
  }

  async revoke(token) {
    if (!token) return;
    const hash = tokenHash(token);
    if (this.sessions.delete(hash)) await this.writeSessions();
  }

  statePath(accountId) {
    return path.join(this.statesDir, `${accountId}.json`);
  }

  async getState(accountId) {
    await this.ready;
    if (this.states.has(accountId)) return this.states.get(accountId);
    let state;
    try {
      state = JSON.parse(await fsp.readFile(this.statePath(accountId), "utf8"));
    } catch (_) {
      state = engine.newState(Date.now());
    }
    if (!state || typeof state !== "object") state = engine.newState(Date.now());
    engine.normalize(state, content, Date.now());
    this.states.set(accountId, state);
    return state;
  }

  schedule(accountId, state) {
    clearTimeout(this.timers.get(accountId));
    this.timers.set(
      accountId,
      setTimeout(() => {
        this.flush(accountId, state).catch((err) => console.error("[momo] save failed", err));
      }, 350)
    );
  }

  async saveNow(accountId, state) {
    await this.ready;
    await this.writeAtomic(this.statePath(accountId), JSON.stringify(state));
  }

  async flush(accountId, state) {
    this.timers.delete(accountId);
    await this.saveNow(accountId, state);
  }

  async flushAll() {
    for (const [accountId, state] of this.states) await this.flush(accountId, state);
  }

  async writeAtomic(file, data) {
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, data, "utf8");
    await fsp.rename(tmp, file);
  }
}

function createServer(opts = {}) {
  const webDir = path.resolve(opts.webDir || path.join(__dirname, "..", "web"));
  const sharedDir = path.resolve(opts.sharedDir || path.join(__dirname, "..", "shared"));
  const dataDir = path.resolve(opts.dataDir || path.join(__dirname, "..", "data"));
  const cloudConfig = opts.cloud || loadConfig(opts.cloudConfig);
  const cloud = createCloudBackend(cloudConfig);
  const store = cloud ? null : new AccountStore(dataDir);
  const streams = new Map(); // accountId -> Set(res)
  const loginFails = new Map();
  const startedAt = Date.now();
  let server;
  let actualPort = 0;
  let closing = false;

  function broadcast(accountId, event, payload) {
    const set = streams.get(accountId);
    if (!set || !set.size) return;
    const body = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of set) {
      try {
        res.write(body);
      } catch (_) {
        /* ignore broken pipe */
      }
    }
  }

  function send(res, status, obj, headers = {}) {
    const data = typeof obj === "string" ? obj : JSON.stringify(obj);
    res.writeHead(status, {
      "Content-Type": typeof obj === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers
    });
    res.end(data);
  }

  async function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(Object.assign(new Error("too_large"), { status: 413 }));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => {
        if (!chunks.length) return resolve({});
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (_) {
          reject(Object.assign(new Error("bad_json"), { status: 400 }));
        }
      });
      req.on("error", reject);
    });
  }

  function tokenFrom(req, url) {
    const header = req.headers.authorization || "";
    if (header.startsWith("Bearer ")) return header.slice(7).trim();
    return url ? String(url.searchParams.get("token") || "") : "";
  }

  async function authenticate(req, url) {
    const token = tokenFrom(req, url);
    if (!token) return null;
    if (cloud) {
      try {
        const out = await cloud.me(token);
        if (!out || out.ok === false || !out.account) return null;
        return { account: out.account, token };
      } catch (_) {
        return null;
      }
    }
    const account = await store.authToken(token);
    if (!account) return null;
    return { account, token };
  }

  function cloudFailure(res, err) {
    if (err instanceof CloudError) {
      const status = err.status === 401 ? 401 : 503;
      return send(res, status, { ok: false, error: status === 401 ? "unauthorized" : "cloud_offline" });
    }
    console.error("[momo] cloud error", err);
    return send(res, 503, { ok: false, error: "cloud_offline" });
  }

  function authRequired(res) {
    return send(res, 401, { ok: false, error: "unauthorized" });
  }

  function cloudState(raw) {
    if (!raw || typeof raw !== "object" || !raw.createdAt || !raw.daily) {
      return engine.newState(Date.now());
    }
    return raw;
  }

  function normalizeCloudPayload(out) {
    if (!out || out.ok === false) return out;
    out.state = cloudState(out.state);
    engine.normalize(out.state, content, Date.now());
    return out;
  }

  async function bootstrap(req, res) {
    if (!cloud) await store.ready;
    const urls = cloud ? [] : lanUrls(actualPort);
    send(res, 200, {
      version: content.VERSION,
      needsAuth: true,
      cloud: !!cloud,
      local: isLocal(req),
      serverName: cloud ? "墨墨 · 云同步" : "墨墨的小屋",
      port: actualPort,
      urls,
      startedAt: new Date(startedAt).toISOString()
    });
  }

  async function register(req, res) {
    const body = await readBody(req);
    if (cloud) {
      try {
        const out = await cloud.register(body.username, body.password);
        if (!out || out.ok === false) {
          const error = (out && out.error) || "register_failed";
          return send(res, error === "username_taken" ? 409 : 400, { ok: false, error });
        }
        return send(res, 200, normalizeCloudPayload(out));
      } catch (err) {
        return cloudFailure(res, err);
      }
    }
    const created = await store.createAccount(body.username, body.password);
    if (!created.ok) {
      const status = created.error === "username_taken" ? 409 : 400;
      return send(res, status, { ok: false, error: created.error });
    }
    const token = await store.createSession(created.account.id);
    return send(res, 200, {
      ok: true,
      token,
      account: publicAccount(created.account),
      state: created.state
    });
  }

  async function login(req, res) {
    const body = await readBody(req);
    const ip = req.socket.remoteAddress || "?";
    const key = `${ip}|${String(body.username || "").trim().toLowerCase()}`;
    const now = Date.now();
    const guard = loginFails.get(key) || { count: 0, resetAt: now + 10 * 60000 };
    if (now > guard.resetAt) {
      guard.count = 0;
      guard.resetAt = now + 10 * 60000;
    }
    if (guard.count >= 8) return send(res, 429, { ok: false, error: "too_many_tries" });

    if (cloud) {
      try {
        const out = await cloud.login(body.username, body.password);
        if (!out || out.ok === false) {
          guard.count += 1;
          loginFails.set(key, guard);
          return send(res, 401, { ok: false, error: (out && out.error) || "wrong_credentials" });
        }
        loginFails.delete(key);
        return send(res, 200, normalizeCloudPayload(out));
      } catch (err) {
        return cloudFailure(res, err);
      }
    }

    const account = await store.verify(body.username, body.password);
    if (!account) {
      guard.count += 1;
      loginFails.set(key, guard);
      return send(res, 401, { ok: false, error: "wrong_credentials" });
    }
    loginFails.delete(key);
    const token = await store.createSession(account.id);
    const state = await store.getState(account.id);
    return send(res, 200, { ok: true, token, account: publicAccount(account), state });
  }

  async function handleCloudAction(req, res, session) {
    const body = await readBody(req);
    const action = body.action || {};
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const remote = await cloud.getState(session.token);
        const now = Date.now();
        let state = cloudState(remote && remote.state);
        const rev = Number((remote && remote.rev) || 0);
        let events = engine.normalize(state, content, now);
        let result = actions.applyAction(state, content, action, now);
        result.ok = result.ok !== false;
        const payload = { ok: result.ok, result, state, now: new Date(now).toISOString() };
        if (events.length) payload.events = events;
        if (!result.ok) return send(res, result.error === "unknown_food" ? 400 : 200, payload);

        const saved = await cloud.saveState(session.token, state, rev);
        if (!saved || saved.ok === false) {
          if (saved && saved.error === "conflict" && saved.state) continue;
          throw new CloudError((saved && saved.error) || "save_failed");
        }
        payload.state = saved.state;
        payload.rev = saved.rev;
        if (action.type !== "heartbeat") {
          broadcast(session.account.id, "state", {
            state: saved.state,
            result: { type: action.type, outcome: result },
            now: payload.now
          });
        }
        return send(res, 200, payload);
      }
      return send(res, 409, { ok: false, error: "conflict" });
    } catch (err) {
      return cloudFailure(res, err);
    }
  }

  async function handleCloudEvents(req, res, session) {
    let current;
    try {
      current = await cloud.getState(session.token);
    } catch (err) {
      return cloudFailure(res, err);
    }
    let state = cloudState(current && current.state);
    let lastRev = Number((current && current.rev) || 0);
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write(`retry: 2500

`);
    res.write(`event: state
data: ${JSON.stringify({ state, now: new Date().toISOString() })}

`);
    if (!streams.has(session.account.id)) streams.set(session.account.id, new Set());
    streams.get(session.account.id).add(res);
    let polling = false;
    const poll = setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const next = await cloud.getState(session.token);
        if (next && next.ok !== false && Number(next.rev || 0) !== lastRev) {
          lastRev = Number(next.rev || 0);
          if (next.state && typeof next.state === "object") {
            broadcast(session.account.id, "state", { state: next.state, now: new Date().toISOString() });
          }
        }
      } catch (_) {
        /* offline; keep the stream open */
      } finally {
        polling = false;
      }
    }, 5000);
    const keep = setInterval(() => {
      try { res.write(`: ping ${Date.now()}

`); } catch (_) { }
    }, 20000);
    req.on("close", () => {
      clearInterval(poll);
      clearInterval(keep);
      const set = streams.get(session.account.id);
      if (set) set.delete(res);
    });
  }

  async function handleAction(req, res, session) {
    const body = await readBody(req);
    const action = body.action || {};
    const state = await store.getState(session.account.id);
    const now = Date.now();
    let events = engine.normalize(state, content, now);
    let result = actions.applyAction(state, content, action, now);
    result.ok = result.ok !== false;
    if (result.ok) store.schedule(session.account.id, state);
    const payload = { ok: result.ok, result, state, now: new Date(now).toISOString() };
    if (events.length) payload.events = events;
    if (!result.ok) return send(res, result.error === "unknown_food" ? 400 : 200, payload);
    if (action.type !== "heartbeat") {
      broadcast(session.account.id, "state", {
        state,
        result: { type: action.type, outcome: result },
        now: payload.now
      });
    }
    send(res, 200, payload);
  }

  async function handleEvents(req, res, url) {
    const session = await authenticate(req, url);
    if (!session) return authRequired(res);
    const state = await store.getState(session.account.id);
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write(`retry: 2500\n\n`);
    res.write(`event: state\ndata: ${JSON.stringify({ state, now: new Date().toISOString() })}\n\n`);
    if (!streams.has(session.account.id)) streams.set(session.account.id, new Set());
    streams.get(session.account.id).add(res);
    const keep = setInterval(() => {
      try {
        res.write(`: ping ${Date.now()}\n\n`);
      } catch (_) {
        /* ignore */
      }
    }, 20000);
    req.on("close", () => {
      clearInterval(keep);
      const set = streams.get(session.account.id);
      if (set) set.delete(res);
    });
  }

  async function serveStatic(req, res, urlPath) {
    let filePath;
    if (urlPath === "/" || urlPath === "") filePath = path.join(webDir, "index.html");
    else if (urlPath.startsWith("/shared/")) {
      filePath = safeJoin(sharedDir, urlPath.slice("/shared".length));
    } else {
      filePath = safeJoin(webDir, urlPath);
    }
    if (!filePath) return send(res, 403, "Forbidden");
    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch (_) {
      return send(res, 404, "Not found");
    }
    if (stat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      try {
        stat = await fsp.stat(filePath);
      } catch (_) {
        return send(res, 404, "Not found");
      }
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": ext === ".html" || ext === ".js" || ext === ".webmanifest" ? "no-cache" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    };
    if (path.basename(filePath) === "sw.js") {
      headers["Cache-Control"] = "no-cache";
      headers["Service-Worker-Allowed"] = "/";
      headers["Content-Type"] = "text/javascript; charset=utf-8";
    }
    res.writeHead(200, headers);
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(filePath)
      .on("error", () => res.end())
      .pipe(res);
  }

  async function route(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    const pathname = decodeURIComponent(url.pathname);

    if (req.method === "OPTIONS") {
      res.writeHead(204, { Allow: "GET, POST, HEAD, OPTIONS" });
      return res.end();
    }

    if (pathname === "/api/health") {
      return send(res, 200, { ok: true, version: content.VERSION, uptime: Math.round((Date.now() - startedAt) / 1000) });
    }
    if (pathname === "/api/content") {
      return send(res, 200, content, { "Cache-Control": "public, max-age=300" });
    }
    if (pathname === "/api/bootstrap" && req.method === "GET") {
      return bootstrap(req, res);
    }
    if (pathname === "/api/auth/register" && req.method === "POST") {
      return register(req, res);
    }
    if (pathname === "/api/auth/login" && req.method === "POST") {
      return login(req, res);
    }
    if (pathname === "/api/auth/logout" && req.method === "POST") {
      const session = await authenticate(req, url);
      if (!session) return authRequired(res);
      if (cloud) {
        try { await cloud.logout(session.token); } catch (_) { }
      } else {
        await store.revoke(session.token);
      }
      return send(res, 200, { ok: true });
    }
    if (pathname === "/api/auth/me" && req.method === "GET") {
      const session = await authenticate(req, url);
      if (!session) return authRequired(res);
      return send(res, 200, { ok: true, account: publicAccount(session.account) });
    }
    if (pathname === "/api/state" && req.method === "GET") {
      const session = await authenticate(req, url);
      if (!session) return authRequired(res);
      if (cloud) {
        try {
          const remote = await cloud.getState(session.token);
          let state = cloudState(remote.state);
          const events = engine.normalize(state, content, Date.now());
          let rev = Number(remote.rev || 0);
          if (!remote.state || events.length) {
            const saved = await cloud.saveState(session.token, state, rev);
            if (saved && saved.ok !== false) rev = Number(saved.rev || rev);
          }
          return send(res, 200, { ok: true, state, rev, events, now: new Date().toISOString() });
        } catch (err) {
          return cloudFailure(res, err);
        }
      }
      const state = await store.getState(session.account.id);
      const events = engine.normalize(state, content, Date.now());
      if (events.length) {
        store.schedule(session.account.id, state);
        broadcast(session.account.id, "state", { state, events, now: new Date().toISOString() });
      }
      return send(res, 200, { ok: true, state, events, now: new Date().toISOString() });
    }
    if (pathname === "/api/events" && req.method === "GET") {
      if (cloud) {
        const session = await authenticate(req, url);
        if (!session) return authRequired(res);
        return handleCloudEvents(req, res, session);
      }
      return handleEvents(req, res, url);
    }
    if (pathname === "/api/friend/code" && req.method === "GET") {
      const session = await authenticate(req, url);
      if (!session) return authRequired(res);
      if (!cloud) return send(res, 200, { ok: false, error: "cloud_required" });
      try { return send(res, 200, await cloud.friendCode(session.token)); }
      catch (err) { return cloudFailure(res, err); }
    }
    if (pathname === "/api/friend/pending" && req.method === "GET") {
      const session = await authenticate(req, url);
      if (!session) return authRequired(res);
      if (!cloud) return send(res, 200, { ok: false, error: "cloud_required" });
      try { return send(res, 200, await cloud.friendPending(session.token)); }
      catch (err) { return cloudFailure(res, err); }
    }
    if (pathname === "/api/friend/status" && req.method === "GET") {
      const session = await authenticate(req, url);
      if (!session) return authRequired(res);
      if (!cloud) return send(res, 200, { ok: false, error: "cloud_required" });
      try { return send(res, 200, await cloud.friendStatus(session.token)); }
      catch (err) { return cloudFailure(res, err); }
    }
    if (pathname === "/api/friend/request" && req.method === "POST") {
      const session = await authenticate(req, url);
      if (!session) return authRequired(res);
      if (!cloud) return send(res, 200, { ok: false, error: "cloud_required" });
      try {
        const body = await readBody(req);
        return send(res, 200, await cloud.friendRequest(session.token, String(body.code || "")));
      } catch (err) { return cloudFailure(res, err); }
    }
    if (pathname === "/api/friend/unbind" && req.method === "POST") {
      const session = await authenticate(req, url);
      if (!session) return authRequired(res);
      if (!cloud) return send(res, 200, { ok: false, error: "cloud_required" });
      try { return send(res, 200, await cloud.friendUnbind(session.token)); }
      catch (err) { return cloudFailure(res, err); }
    }
    if (pathname === "/api/friend/feed" && req.method === "POST") {
      const session = await authenticate(req, url);
      if (!session) return authRequired(res);
      if (!cloud) return send(res, 200, { ok: false, error: "cloud_required" });
      try { const body = await readBody(req); return send(res, 200, await cloud.friendFeed(session.token, String(body.foodId || ""))); }
      catch (err) { return cloudFailure(res, err); }
    }
    if (pathname === "/api/friend/activity/request" && req.method === "POST") {
      const session = await authenticate(req, url);
      if (!session) return authRequired(res);
      if (!cloud) return send(res, 200, { ok: false, error: "cloud_required" });
      try { const body = await readBody(req); return send(res, 200, await cloud.friendActivityRequest(session.token, String(body.kind || ""), String(body.option || ""))); }
      catch (err) { return cloudFailure(res, err); }
    }
    if (pathname === "/api/friend/activity/respond" && req.method === "POST") {
      const session = await authenticate(req, url);
      if (!session) return authRequired(res);
      if (!cloud) return send(res, 200, { ok: false, error: "cloud_required" });
      try { const body = await readBody(req); return send(res, 200, await cloud.friendActivityRespond(session.token, String(body.id || ""), !!body.accept)); }
      catch (err) { return cloudFailure(res, err); }
    }
    if (pathname === "/api/friend/activity/cancel" && req.method === "POST") {
      const session = await authenticate(req, url);
      if (!session) return authRequired(res);
      if (!cloud) return send(res, 200, { ok: false, error: "cloud_required" });
      try { const body = await readBody(req); return send(res, 200, await cloud.friendActivityCancel(session.token, String(body.id || ""))); }
      catch (err) { return cloudFailure(res, err); }
    }
    if (pathname === "/api/friend/events" && req.method === "GET") {
      const session = await authenticate(req, url);
      if (!session) return authRequired(res);
      if (!cloud) return send(res, 200, { ok: true, events: [] });
      try { return send(res, 200, await cloud.friendEvents(session.token)); }
      catch (err) { return cloudFailure(res, err); }
    }
    if (pathname === "/api/friend/events/ack" && req.method === "POST") {
      const session = await authenticate(req, url);
      if (!session) return authRequired(res);
      if (!cloud) return send(res, 200, { ok: true });
      try { const body = await readBody(req); return send(res, 200, await cloud.friendEventAck(session.token, String(body.id || ""))); }
      catch (err) { return cloudFailure(res, err); }
    }
    if (pathname === "/api/action" && req.method === "POST") {
      const session = await authenticate(req, url);
      if (!session) return authRequired(res);
      return cloud ? handleCloudAction(req, res, session) : handleAction(req, res, session);
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(res, 405, "Method not allowed");
    }
    return serveStatic(req, res, pathname);
  }

  const handler = (req, res) => {
    route(req, res).catch((err) => {
      console.error("[momo] request failed", err);
      if (!res.headersSent) send(res, err.status || 500, { ok: false, error: err.message || "server_error" });
      else res.end();
    });
  };

  async function listen(desiredPort) {
    if (!cloud) await store.ready;
    const base = Number(desiredPort || 0);
    const attempts = base ? 20 : 1;
    for (let i = 0; i < attempts; i++) {
      const tryPort = base ? base + i : 0;
      try {
        await new Promise((resolve, reject) => {
          const s = http.createServer(handler);
          s.once("error", reject);
          s.listen(tryPort, "0.0.0.0", () => {
            s.removeListener("error", reject);
            server = s;
            actualPort = s.address().port;
            resolve();
          });
        });
        break;
      } catch (err) {
        if (err.code !== "EADDRINUSE" || i === attempts - 1) throw err;
        await sleep(120);
      }
    }
    const urls = lanUrls(actualPort);
    return {
      port: actualPort,
      cloud: !!cloud,
      urls: cloud ? [] : urls,
      localUrl: `http://127.0.0.1:${actualPort}`,
      dataDir,
      webDir
    };
  }

  async function close() {
    if (closing) return;
    closing = true;
    for (const set of streams.values()) for (const res of set) res.end();
    streams.clear();
    if (store) await store.flushAll().catch(() => {});
    if (server) await new Promise((r) => server.close(r));
  }

  return {
    listen,
    close,
    store,
    get info() {
      return {
        port: actualPort,
        cloud: !!cloud,
        urls: cloud ? [] : lanUrls(actualPort),
        localUrl: `http://127.0.0.1:${actualPort}`,
        dataDir
      };
    }
  };
}

module.exports = { createServer, lanUrls };

if (require.main === module) {
  const port = Number(process.env.MOMO_PORT || 8787);
  const srv = createServer({
    dataDir: process.env.MOMO_DATA || path.join(__dirname, "..", "data"),
    webDir: process.env.MOMO_WEB || path.join(__dirname, "..", "web"),
    sharedDir: process.env.MOMO_SHARED || path.join(__dirname, "..", "shared"),
    cloudConfig: process.env.MOMO_CLOUD || path.join(__dirname, "..", "cloud.json")
  });
  srv
    .listen(port)
    .then((info) => {
      console.log(`\n  墨墨的小屋已启动  v${content.VERSION}`);
      console.log(`  本机: ${info.localUrl}`);
      for (const u of info.urls) console.log(`  手机: ${u.url}  (${u.name})`);
      console.log(`  在电脑/手机打开地址，登录同一个账号即可同步。\n`);
      const shutdown = () => srv.close().then(() => process.exit(0));
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    })
    .catch((err) => {
      console.error("启动失败:", err);
      process.exit(1);
    });
}
