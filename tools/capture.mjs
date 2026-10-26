/* Headless Chrome + CDP capture/interaction harness.
 * Usage: node tools/capture.mjs [scenario]
 * Runs its own server on a scratch data dir, drives the UI, writes PNGs to test/.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEST = path.join(ROOT, "test");
const NODE = process.execPath;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 8791;
const DATA = path.join(TEST, "data-capture");

const scenario = process.argv[2] || "all";
const OUT = path.join(TEST, "shots");
fs.mkdirSync(OUT, { recursive: true });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn, timeout = 20000, interval = 150) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try {
      const v = await fn();
      if (v) return v;
      last = v;
    } catch (err) {
      last = err;
    }
    await sleep(interval);
  }
  throw new Error(`timeout waiting: ${last}`);
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
      } else if (msg.method) {
        const set = this.events.get(msg.method);
        if (set) for (const fn of set) fn(msg.params);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 20000);
    });
  }

  on(method, fn) {
    if (!this.events.has(method)) this.events.set(method, new Set());
    this.events.get(method).add(fn);
  }

  async eval(expression, awaitPromise = false) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise,
      userGesture: true
    });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || "eval failed");
    return res.result && res.result.value;
  }

  async screenshot(file) {
    const res = await this.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    await fsp.writeFile(path.join(OUT, file), Buffer.from(res.data, "base64"));
    console.log("shot", file);
  }
}

function startChrome(width, height) {
  const userDir = path.join(TEST, `.chrome-${Date.now()}`);
  fs.rmSync(userDir, { recursive: true, force: true });
  const proc = spawn(
    CHROME,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-crashpad",
      "--disable-breakpad",
      "--no-first-run",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--remote-debugging-port=0",
      `--user-data-dir=${userDir}`,
      `--window-size=${width},${height}`,
      "about:blank"
    ],
    { stdio: "ignore", windowsHide: true }
  );
  return { proc, userDir };
}

async function connectChrome(userDir) {
  const portFile = path.join(userDir, "DevToolsActivePort");
  await waitFor(() => fs.existsSync(portFile), 15000);
  const raw = fs.readFileSync(portFile, "utf8").split("\n");
  const port = raw[0].trim();
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("no page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const cdp = new CDP(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }]
  });
  return cdp;
}

async function setViewport(cdp, width, height, mobile = false) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
    screenWidth: width,
    screenHeight: height
  });
}

async function navigate(cdp, url) {
  await cdp.send("Page.navigate", { url });
  await sleep(600);
  await waitFor(
    async () =>
      await cdp.eval(`(() => {
        const boot = document.getElementById('boot');
        const hidden = !boot || getComputedStyle(boot).display === 'none';
        const pair = document.getElementById('pairScreen');
        const pairOpen = pair && !pair.classList.contains('hidden');
        return (hidden && !pairOpen) || pairOpen;
      })()`),
    20000
  );
  await sleep(500);
}

async function click(cdp, selector, index = 0) {
  const point = await cdp.eval(`(() => {
    const nodes = document.querySelectorAll(${JSON.stringify(selector)});
    const el = nodes[${index}];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!point) throw new Error(`missing selector ${selector}[${index}]`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1
  });
  await sleep(420);
}

async function tapPet(cdp, times = 1) {
  const point = await cdp.eval(`(() => {
    const r = document.querySelector('.pet-zone').getBoundingClientRect();
    return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.62 };
  })()`);
  for (let i = 0; i < times; i++) {
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await sleep(105);
  }
  await sleep(500);
}

let AUTH = null;

async function api(action, body = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/action`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${AUTH.token}` },
    body: JSON.stringify({ action: Object.assign({ type: action }, body) })
  });
  return res.json();
}

async function prepareAuth(cdp) {
  const source = `
    try {
      localStorage.setItem("momo.token", ${JSON.stringify(AUTH.token)});
      localStorage.setItem("momo.account", ${JSON.stringify(JSON.stringify(AUTH.account))});
    } catch (_) {}
  `;
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source });
}

async function main() {
  fs.rmSync(DATA, { recursive: true, force: true });
  const server = spawn(NODE, ["server/server.js"], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { MOMO_PORT: String(PORT), MOMO_DATA: DATA }),
    stdio: "ignore",
    windowsHide: true
  });

  let chrome;
  let cdp;
  try {
    await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/api/health`).catch(() => null))?.ok, 15000);
    const regRes = await fetch(`http://127.0.0.1:${PORT}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "momo", password: "momopet123" })
    });
    AUTH = await regRes.json();
    if (!AUTH.ok) throw new Error("register failed: " + JSON.stringify(AUTH));
    console.log("account", AUTH.account.username, "port", PORT);

    const built = startChrome(430, 932);
    chrome = built.proc;
    cdp = await connectChrome(built.userDir);
    if (scenario !== "auth") await prepareAuth(cdp);

    if (scenario === "all" || scenario === "mobile") {
      await setViewport(cdp, 430, 932, true);
      await navigate(cdp, `http://127.0.0.1:${PORT}/`);
      await cdp.screenshot("mobile-main.png");

      const info = await cdp.eval(`(() => ({
        name: document.getElementById('topName').textContent,
        mood: document.getElementById('topMoodValue').textContent,
        status: document.getElementById('statusText').textContent,
        pet: !!document.querySelector('.pet-zone'),
        bubble: document.getElementById('bubble').className
      }))()`);
      console.log("mobile state", info);

      await sleep(2200);
      await tapPet(cdp, 1);
      await cdp.screenshot("mobile-tap.png");
      const line = await cdp.eval(`document.getElementById('bubbleText').textContent`);
      console.log("tap line:", line);

      await tapPet(cdp, 6);
      await cdp.screenshot("mobile-spam.png");
      const dots = await cdp.eval(`document.getElementById('bubbleText').textContent`);
      console.log("spam bubble:", dots, "len", dots.length);
      if (!dots.includes("。")) throw new Error("spam did not produce 。");

      await click(cdp, "#mFeed");
      await cdp.screenshot("mobile-feed.png");
      await click(cdp, ".food-row", 0);
      await click(cdp, ".option-chip", 1);
      await cdp.screenshot("mobile-feed-options.png");
      await click(cdp, ".sheet-foot .btn");
      await sleep(800);
      await cdp.screenshot("mobile-fed.png");
      const fedLine = await cdp.eval(`document.getElementById('bubbleText').textContent`);
      console.log("fed line:", fedLine);
      const state = await (await fetch(`http://127.0.0.1:${PORT}/api/state`, { headers: { authorization: `Bearer ${AUTH.token}` } })).json();
      console.log("feeds", state.state.totals.feeds, "mood", state.state.mood);
      if (state.state.totals.feeds < 1) throw new Error("feed not persisted");

      await navigate(cdp, `http://127.0.0.1:${PORT}/`);
      await click(cdp, "#mExercise");
      await cdp.screenshot("mobile-exercise.png");
      await click(cdp, ".sheet-foot .btn");
      await sleep(800);
      await cdp.screenshot("mobile-exercising.png");
      await tapPet(cdp, 1);
      await cdp.screenshot("mobile-exercise-peek.png");

      await click(cdp, "#exerciseEarly");
      await sleep(900);
      await cdp.screenshot("mobile-exercise-summary.png");
      await click(cdp, "#recapOk");

      await navigate(cdp, `http://127.0.0.1:${PORT}/`);
      await click(cdp, "#mOuting");
      await cdp.screenshot("mobile-outing.png");
      await click(cdp, ".sheet-foot .btn");
      await sleep(700);
      await cdp.screenshot("mobile-away.png");
    }

    if (scenario === "auth") {
      await setViewport(cdp, 430, 932, true);
      await navigate(cdp, `http://127.0.0.1:${PORT}/`);
      await sleep(500);
      await cdp.screenshot("auth-mobile.png");
      const hasAuth = await cdp.eval(`!document.getElementById('authScreen').classList.contains('hidden')`);
      console.log("auth screen", hasAuth);
      await cdp.eval(`(() => {
        document.querySelector('.auth-tab[data-mode="register"]').click();
        document.getElementById('authUser').value = 'webnew';
        document.getElementById('authPass').value = 'webpass123';
        document.getElementById('authPass2').value = 'webpass123';
        document.getElementById('authBtn').click();
        return true;
      })()`);
      await sleep(1100);
      await cdp.screenshot("auth-created.png");
      const created = await cdp.eval(`(() => ({authVisible: !document.getElementById('authScreen').classList.contains('hidden'), notice: document.getElementById('authError').textContent, mode: document.querySelector('.auth-tab.active')?.dataset.mode}))()`);
      console.log("after register", created);
      await cdp.eval(`(() => { document.getElementById('authPass').value = 'webpass123'; document.getElementById('authBtn').click(); return true; })()`);
      await sleep(1800);
      await cdp.screenshot("auth-logged-in.png");
      const after = await cdp.eval(`(() => ({auth: document.getElementById('authScreen').classList.contains('hidden'), name: document.getElementById('topName').textContent}))()`);
      console.log("after login", after);
    }

    if (scenario === "all" || scenario === "profile") {
      await setViewport(cdp, 430, 932, true);
      await navigate(cdp, `http://127.0.0.1:${PORT}/profile.html`);
      await sleep(600);
      await cdp.screenshot("profile-mobile.png");
      await cdp.eval(`document.getElementById('pChart').scrollIntoView({block:'center'});`);
      await sleep(400);
      await cdp.screenshot("profile-week.png");
      await click(cdp, "#chartPrev");
      await cdp.screenshot("profile-week-prev.png");
      await click(cdp, "#chartCal");
      await sleep(350);
      await cdp.screenshot("profile-calendar.png");
      const calDays = await cdp.eval(`document.querySelectorAll('.cal-day[data-date]').length`);
      console.log("calendar days", calDays);
      await cdp.eval(`document.getElementById('pModal').click()`);
      await navigate(cdp, `http://127.0.0.1:${PORT}/`);
      await sleep(500);
      await click(cdp, "#bgBtn");
      await cdp.screenshot("mobile-background.png");
      await click(cdp, '.scene-chip[data-scene="rain"]');
      await sleep(500);
      await cdp.screenshot("mobile-scene-rain.png");
      const sceneBody = await cdp.eval(`document.body.dataset.scene`);
      console.log("body scene", sceneBody);

      await setViewport(cdp, 980, 820, false);
      await navigate(cdp, `http://127.0.0.1:${PORT}/profile.html`);
      await sleep(600);
      await cdp.screenshot("profile-desktop.png");
    }

    if (scenario === "all" || scenario === "desktop") {
      await setViewport(cdp, 380, 620, false);
      await navigate(cdp, `http://127.0.0.1:${PORT}/?ui=desktop&preview=1`);
      await cdp.screenshot("desktop-main.png");

      await setViewport(cdp, 420, 660, false);
      await navigate(cdp, `http://127.0.0.1:${PORT}/?ui=desktop&preview=1`);
      await sleep(300);
      await cdp.screenshot("desktop-frame.png");
    }
  } finally {
    try {
      cdp?.ws?.close();
    } catch (_) {}
    try {
      chrome?.kill();
    } catch (_) {}
    try {
      server.kill();
    } catch (_) {}
    await sleep(300);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
