/* API smoke test: starts the real server on an ephemeral port, exercises the
 * account, feeding, exercise, outing, SSE and persistence paths. */
"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { createServer } = require("../server/server.js");
const content = require("../shared/content.js");
const engine = require("../shared/engine.js");

const DATA = path.join(__dirname, "..", "test", "data-api");

async function main() {
  fs.rmSync(DATA, { recursive: true, force: true });
  let srv = createServer({ dataDir: DATA });
  let info = await srv.listen(0);
  let base = info.localUrl;
  console.log("server", info.port, "data", DATA);

  async function json(pathname, options = {}) {
    const res = await fetch(base + pathname, options);
    let body = null;
    try { body = await res.json(); } catch (_) { body = null; }
    return { res, body };
  }

  function auth(token) {
    return { authorization: `Bearer ${token}` };
  }

  let r = await json("/api/bootstrap");
  assert.equal(r.res.status, 200);
  assert.equal(r.body.needsAuth, true);
  assert.ok(r.body.urls.length >= 1);
  assert.equal(r.body.code, undefined);
  assert.equal(r.body.pairUrl, undefined);
  console.log("bootstrap", r.body.serverName, r.body.urls.length, "urls");

  // registration + password binding
  r = await json("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "momo_test", password: "secret123" })
  });
  assert.equal(r.res.status, 200);
  assert.equal(r.body.ok, true);
  assert.ok(r.body.token.length > 20);
  const token = r.body.token;
  assert.equal(r.body.account.username, "momo_test");
  assert.equal(r.body.state.health, 70);
  assert.equal(r.body.state.fatigue, 8);
  console.log("registered", r.body.account.username);

  // duplicate + validation
  r = await json("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "momo_test", password: "secret123" })
  });
  assert.equal(r.res.status, 409);
  assert.equal(r.body.error, "username_taken");
  r = await json("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "x", password: "123" })
  });
  assert.equal(r.res.status, 400);
  assert.equal(r.body.error, "bad_username");
  r = await json("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "momo_test", password: "wrongpass" })
  });
  assert.equal(r.res.status, 401);
  assert.equal(r.body.error, "wrong_credentials");

  // auth gate
  r = await json("/api/state");
  assert.equal(r.res.status, 401);
  r = await json("/api/state", { headers: auth("not-a-token") });
  assert.equal(r.res.status, 401);

  // state + feed (new food, satiety adds health a little)
  r = await json("/api/state", { headers: auth(token) });
  assert.equal(r.res.status, 200);
  assert.equal(r.body.state.totals.feeds, 0);
  r = await json("/api/action", {
    method: "POST",
    headers: { "content-type": "application/json", ...auth(token) },
    body: JSON.stringify({ action: { type: "feed", itemId: "malatang", optionId: "hot" } })
  });
  assert.equal(r.res.status, 200);
  assert.equal(r.body.result.ok, true);
  assert.ok(r.body.result.line.length > 4);
  assert.equal(r.body.result.option.id, "hot");
  assert.ok(r.body.result.healthDelta > 0);
  assert.ok(r.body.state.health > 70);
  assert.ok(r.body.state.fullness > 34);
  console.log("feed", r.body.result.line, "health", r.body.state.health);

  // exercise start, cannot feed while busy, finish early records it
  r = await json("/api/action", {
    method: "POST",
    headers: { "content-type": "application/json", ...auth(token) },
    body: JSON.stringify({ action: { type: "exercise_start", kindId: "rope", minutes: 5 } })
  });
  assert.equal(r.body.result.ok, true);
  assert.ok(r.body.state.exercise);
  assert.ok(r.body.result.line.length > 2);
  const fatigueBefore = r.body.state.fatigue;
  r = await json("/api/action", {
    method: "POST",
    headers: { "content-type": "application/json", ...auth(token) },
    body: JSON.stringify({ action: { type: "feed", itemId: "chocolate", optionId: "dark" } })
  });
  assert.equal(r.body.ok, false);
  assert.equal(r.body.result.error, "busy");
  r = await json("/api/action", {
    method: "POST",
    headers: { "content-type": "application/json", ...auth(token) },
    body: JSON.stringify({ action: { type: "exercise_finish", early: true } })
  });
  assert.equal(r.body.result.ok, true);
  assert.ok(r.body.result.healthDelta > 0);
  assert.ok(r.body.result.fatigueDelta > 0);
  assert.ok(r.body.state.fatigue > fatigueBefore);
  assert.equal(r.body.state.exercise, null);
  assert.equal(r.body.state.totals.exercises, 1);
  assert.equal(r.body.state.exerciseHistory.length, 1);
  assert.equal(r.body.state.lastExercise.unseen, true);
  console.log("exercise", r.body.result.healthDelta, r.body.result.fatigueDelta, r.body.state.fatigue);

  r = await json("/api/action", {
    method: "POST",
    headers: { "content-type": "application/json", ...auth(token) },
    body: JSON.stringify({ action: { type: "exercise_seen" } })
  });
  assert.equal(r.body.state.lastExercise.unseen, false);

  // background picker
  r = await json("/api/action", {
    method: "POST",
    headers: { "content-type": "application/json", ...auth(token) },
    body: JSON.stringify({ action: { type: "set_background", background: "rain" } })
  });
  assert.equal(r.body.result.ok, true);
  assert.equal(r.body.state.background, "rain");
  r = await json("/api/action", {
    method: "POST",
    headers: { "content-type": "application/json", ...auth(token) },
    body: JSON.stringify({ action: { type: "set_background", background: "space" } })
  });
  assert.equal(r.body.ok, false);
  assert.equal(r.body.result.error, "unknown_background");
  console.log("background", r.body.state.background);

  // account isolation
  r = await json("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "other", password: "other123" })
  });
  const otherToken = r.body.token;
  r = await json("/api/state", { headers: auth(otherToken) });
  assert.equal(r.body.state.totals.feeds, 0);
  assert.equal(r.body.state.totals.exercises, 0);
  assert.equal(r.body.state.health, 70);
  r = await json("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "momo_test", password: "secret123" })
  });
  assert.equal(r.body.ok, true);
  const reloginToken = r.body.token;
  r = await json("/api/state", { headers: auth(reloginToken) });
  assert.equal(r.body.state.totals.feeds, 1);
  assert.equal(r.body.state.totals.exercises, 1);
  console.log("account isolation + relogin ok");

  // SSE with account token
  const ac = new AbortController();
  const sse = await fetch(`${base}/api/events?token=${encodeURIComponent(reloginToken)}`, { signal: ac.signal });
  assert.equal(sse.status, 200);
  const reader = sse.body.getReader();
  const chunk = await reader.read();
  const text = Buffer.from(chunk.value).toString("utf8");
  assert.ok(text.includes("event: state"));
  ac.abort();

  // engine-level outing fatigue (avoids waiting ten real minutes)
  const t0 = Date.parse("2026-10-26T10:00:00+08:00");
  const st = engine.newState(t0);
  assert.equal(engine.startOuting(st, content, "park", 10, t0).ok, true);
  const out = engine.finishOuting(st, content, t0 + 10 * 60000 + 500, false);
  assert.ok(out.fatigueDelta > 0);
  assert.ok(st.fatigue > 8);
  assert.ok(out.surprise && out.surprise.length > 4);
  assert.equal(st.outingHistory[0].surprise, out.surprise);
  console.log("outing fatigue +", out.fatigueDelta, "surprise", out.surprise);

  // reset is per account and keeps account
  r = await json("/api/action", {
    method: "POST",
    headers: { "content-type": "application/json", ...auth(reloginToken) },
    body: JSON.stringify({ action: { type: "reset", confirm: "bad" } })
  });
  assert.equal(r.body.ok, false);
  r = await json("/api/state", { headers: auth(reloginToken) });
  const created = r.body.state.createdAt;
  r = await json("/api/action", {
    method: "POST",
    headers: { "content-type": "application/json", ...auth(reloginToken) },
    body: JSON.stringify({ action: { type: "reset", confirm: created } })
  });
  assert.equal(r.body.state.totals.feeds, 0);
  assert.equal(r.body.state.totals.exercises, 0);

  const beforeClose = r.body.state.totals.feeds;

  // persistence of account data + sessions across restart
  await srv.close();
  srv = createServer({ dataDir: DATA });
  info = await srv.listen(0);
  base = info.localUrl;
  r = await json("/api/state", { headers: auth(reloginToken) });
  assert.equal(r.res.status, 200);
  assert.equal(r.body.state.totals.feeds, beforeClose);
  r = await json("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "momo_test", password: "secret123" })
  });
  assert.equal(r.body.ok, true);
  console.log("persisted account ok");

  // password is hashed
  const accounts = JSON.parse(fs.readFileSync(path.join(DATA, "accounts.json"), "utf8"));
  for (const account of accounts.accounts) {
    assert.equal(account.password, undefined);
    assert.ok(account.salt.length >= 16);
    assert.ok(account.hash.length >= 64);
  }

  // logout revokes the token
  r = await json("/api/auth/logout", {
    method: "POST",
    headers: auth(reloginToken)
  });
  assert.equal(r.body.ok, true);
  r = await json("/api/state", { headers: auth(reloginToken) });
  assert.equal(r.res.status, 401);

  // static assets
  r = await fetch(`${info.localUrl}/`);
  assert.equal(r.status, 200);
  assert.ok((await r.text()).includes("墨墨"));
  r = await fetch(`${info.localUrl}/shared/content.js`);
  assert.equal(r.status, 200);
  assert.ok((await r.text()).includes("EXERCISES"));

  await srv.close();
  console.log("ALL API TESTS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
