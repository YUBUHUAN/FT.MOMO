/* Main pet UI: tap / combo, feeding, outings, sheets, menu, sync. */
import { Api } from "./api.js";
import { Shell } from "./shell.js";
import { Bubble, Sfx, burst, foodFly, moodToast, startBlinking, toast } from "./fx.js";
import { $, clamp, el, escapeHtml, fmtClock, fmtDate, fmtDuration, pick } from "./util.js";

const C = window.MomoContent;
const E = window.MomoEngine;

const params = new URLSearchParams(location.search);
const isElectron = Shell.isElectron;
const mode = isElectron ? "desktop" : params.get("ui") === "desktop" ? "desktop" : "mobile";

if (mode === "desktop") {
  document.body.classList.remove("mode-mobile");
  document.body.classList.add("mode-desktop");
  if (params.get("preview")) document.body.classList.add("preview");
}

const S = {
  api: null,
  state: null,
  settings: { sound: true },
  bubble: null,
  sfx: new Sfx(true),
  booted: false,
  connected: false,
  combo: 0,
  lastTapAt: 0,
  burstCount: 0,
  burstTimer: null,
  lastBurstAt: 0,
  lastBurstCount: 0,
  lastHungerLevel: "",
  lastSleeping: false,
  friendInvite: null,
  friendPoll: null,
  press: null,
  dragging: false,
  ignore: false,
  petMask: null,
  awayTimer: null,
  awayFinishing: false,
  exerciseTimer: null,
  exerciseFinishing: false,
  exerciseFxKind: "",
  exerciseSweatTimer: null,
  exerciseFlavorTimer: null,
  authMode: "login",
  summaryType: "outing",
  recapKey: null,
  recapOpen: false,
  sheetOpen: false,
  menuOpen: false,
  pending: false,
  retryTimer: null,
  lastOfflineToast: 0
};

const els = {
  boot: $("#boot"),
  auth: $("#authScreen"),
  authUser: $("#authUser"),
  authPass: $("#authPass"),
  authPass2: $("#authPass2"),
  authBtn: $("#authBtn"),
  authError: $("#authError"),
  authTabs: Array.from(document.querySelectorAll(".auth-tab")),
  topName: $("#topName"),
  topSub: $("#topSub"),
  topMood: $("#topMood"),
  topMoodEmoji: $("#topMoodEmoji"),
  topMoodValue: $("#topMoodValue"),
  petZone: $("#petZone"),
  petBody: $("#petBody"),
  petImg: $("#petImg"),
  fxLayer: $("#fxLayer"),
  bubble: $("#bubble"),
  sceneLamp: $("#sceneLamp"),
  bubbleText: $("#bubbleText"),
  bubbleMark: $("#bubbleMark"),
  moodToast: $("#moodToast"),
  awayCard: $("#awayCard"),
  awayScene: $("#awayScene"),
  awayEmoji: $("#awayEmoji"),
  awayTitle: $("#awayTitle"),
  awayCount: $("#awayCount"),
  awayNote: $("#awayNote"),
  awayEarly: $("#awayEarly"),
  awayPeek: $("#awayPeek"),
  exerciseCard: $("#exerciseCard"),
  exerciseScene: $("#exerciseScene"),
  exerciseEmoji: $("#exerciseEmoji"),
  exerciseKicker: $("#exerciseKicker"),
  exerciseTitle: $("#exerciseTitle"),
  exerciseCount: $("#exerciseCount"),
  exerciseNote: $("#exerciseNote"),
  exerciseEarly: $("#exerciseEarly"),
  exercisePeek: $("#exercisePeek"),
  dockFeed: $("#dockFeed"),
  dockOuting: $("#dockOuting"),
  dockExercise: $("#dockExercise"),
  dockProfile: $("#dockProfile"),
  mFeed: $("#mFeed"),
  mOuting: $("#mOuting"),
  mExercise: $("#mExercise"),
  mProfile: $("#mProfile"),
  openProfileTop: $("#openProfileTop"),
  bgBtn: $("#bgBtn"),
  dockBackground: $("#dockBackground"),
  syncDot: $("#syncDot"),
  statusDot: $("#statusDot"),
  statusText: $("#statusText"),
  ctxMenu: $("#ctxMenu"),
  sheetHost: $("#sheetHost"),
  sheetBackdrop: $("#sheetBackdrop"),
  sheet: $("#sheet"),
  modalLayer: $("#modalLayer"),
  toast: $("#toast")
};

S.bubble = new Bubble(els.bubble, els.bubbleText, els.bubbleMark);

/* ------------------------------------------------------------------ boot */

async function init() {
  document.body.classList.add("js-ready");
  startBlinking(els.petBody);
  buildPetMask();
  bindEvents();

  S.settings = await Shell.getSettings();
  S.sfx.setEnabled(!!S.settings.sound);
  Shell.onSettings((next) => {
    S.settings = Object.assign({}, S.settings, next);
    S.sfx.setEnabled(!!S.settings.sound);
  });

  try {
    const api = await Api.boot();
    S.api = api;
    if (api.offline) {
      setConnected(false);
      const cached = api.cached || S.state;
      if (cached) applyState(cached);
      else applyState(E.newState(Date.now(), C.DEFAULT_NAME), false);
      startRetry();
    } else {
      wireApi();
      const state = await api.state();
      applyState(state, false);
      startTimers();
      startFriendWatch();
    }
  } catch (err) {
    if (err && err.needsAuth) {
      showAuth(err.bootstrap);
    } else {
      setConnected(false);
      const cached = Api.cachedState();
      if (cached) applyState(cached);
      else applyState(E.newState(Date.now(), C.DEFAULT_NAME), false);
      startRetry();
      toast("暂时连不上小屋，正在重试…", 3000);
    }
  }

  finishBoot();
  setTimeout(firstTip, 1500);
}

function friendKindLabel(kind) {
  return kind === "exercise" ? "双人运动" : "双人出游";
}

function friendStatusLabel(status) {
  return ({ sleeping: "睡觉中", outing: "出游中", exercise: "运动中" })[status] || "在房间里";
}

function hideFriendStrip() {
  const strip = document.getElementById("friendStrip");
  if (strip) strip.classList.add("hidden");
}

function showFriendStrip(text, actions) {
  const strip = document.getElementById("friendStrip");
  const label = document.getElementById("friendStripText");
  const box = document.getElementById("friendStripActions");
  if (!strip || !label || !box) return;
  label.textContent = text;
  box.innerHTML = "";
  (actions || []).forEach((a) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = a.label;
    if (a.primary) btn.className = "primary";
    btn.addEventListener("click", a.onClick);
    box.appendChild(btn);
  });
  strip.classList.remove("hidden");
}

function showFriendLine(lines, data) {
  const list = C.FRIEND_LINES && C.FRIEND_LINES[lines] || [];
  let line = list.length ? pick(list) : "【{name}】来找你了。";
  Object.entries(data || {}).forEach(([k, v]) => { line = line.split(`{${k}}`).join(v); });
  if (S.bubble) S.bubble.show(line, { duration: 5200 });
}

async function refreshFriendState() {
  try {
    if (!S.api) return;
    const state = await S.api.state();
    applyState(state);
  } catch (_) { }
}

async function acceptFriendInvite(id) {
  if (!S.api || !id) return;
  try {
    await S.api.friendActivityRespond(id, true);
    S.friendInvite = null;
    hideFriendStrip();
    toast("好，一起出发。");
    await refreshFriendState();
  } catch (err) {
    toast(err.message === "busy" ? "对方现在没空，或者你们正在忙别的。" : "接受失败，稍后再试");
  }
}

async function declineFriendInvite(id) {
  if (!S.api || !id) return;
  try {
    await S.api.friendActivityRespond(id, false);
    S.friendInvite = null;
    hideFriendStrip();
    toast("已拒绝这次邀请。");
  } catch (_) { toast("操作失败，稍后再试"); }
}

async function cancelFriendActivity(id) {
  if (!S.api || !id) return;
  try {
    await S.api.friendActivityCancel(id);
    hideFriendStrip();
    toast("已取消。");
    await refreshFriendState();
  } catch (_) { toast("取消失败，稍后再试"); }
}

async function checkFriendEvents() {
  if (!S.api || !S.state || S.api.offline) return;
  try {
    const out = await S.api.friendEvents();
    if (!out || out.ok === false) return;
    const events = out.events || [];
    for (const ev of events) {
      const p = ev.payload || {};
      if (ev.type === "feed") {
        showFriendLine("feed", { name: p.from || "密友", food: p.food || "好吃的" });
        await S.api.friendEventAck(ev.id).catch(() => {});
        refreshFriendState();
      } else if (ev.type === "activity_invite") {
        S.friendInvite = { id: p.id || (out.activity && out.activity.id), kind: p.kind, option: p.option, from: p.from };
        showFriendStrip(`【${p.from || "密友"}】想和你${friendKindLabel(p.kind)}（${p.option || ""}）。`, [
          { label: "同意", primary: true, onClick: () => acceptFriendInvite(S.friendInvite && S.friendInvite.id) },
          { label: "拒绝", onClick: () => declineFriendInvite(S.friendInvite && S.friendInvite.id) }
        ]);
      } else if (ev.type === "activity_started") {
        showFriendLine(p.kind === "exercise" ? "exercise_start" : "outing_start", { name: p.from || "密友", option: p.option || "" });
        await S.api.friendEventAck(ev.id).catch(() => {});
        refreshFriendState();
      } else if (ev.type === "activity_declined" || ev.type === "activity_cancelled" || ev.type === "activity_finished") {
        S.sfx.play("tap", 1);
        const text = ev.type === "activity_declined" ? "对方拒绝了这次邀请。"
          : ev.type === "activity_cancelled" ? "这次双人活动取消了。"
          : "双人活动结束了。";
        S.bubble && S.bubble.show(text, { duration: 3600 });
        await S.api.friendEventAck(ev.id).catch(() => {});
        refreshFriendState();
      }
    }

    const act = out.activity;
    const current = S.state.friendActivity;
    if (current && current.endsAt > Date.now()) {
      const left = Math.max(0, Math.ceil((current.endsAt - Date.now()) / 60000));
      showFriendStrip(`和【${current.partner || "密友"}】${friendKindLabel(current.kind)}中 · 还剩 ${left} 分钟。`, [
        { label: "提前结束", onClick: () => cancelFriendActivity(current.id) }
      ]);
    } else if (act && act.status === "pending" && act.from === "me") {
      showFriendStrip(`已向【${S.friendInvite ? S.friendInvite.from : "密友"}】发出${friendKindLabel(act.kind)}邀请，等待回复。`, [
        { label: "取消", onClick: () => cancelFriendActivity(act.id) }
      ]);
    } else if (!S.friendInvite) {
      hideFriendStrip();
    }
  } catch (_) { }
}

function startFriendWatch() {
  if (S.friendPoll) clearInterval(S.friendPoll);
  checkFriendEvents();
  S.friendPoll = setInterval(checkFriendEvents, 8000);
}

function finishBoot() {
  if (S.booted) return;
  S.booted = true;
  els.boot.classList.add("gone");
  setTimeout(() => (els.boot.style.display = "none"), 500);
  maybeShowSummary();
  renderScene();
  renderAway();
  renderExercise();
}

function maybeHungerNotice(s) {
  const fullness = Number(s.fullness) || 0;
  const level = fullness <= 10 ? "starving" : fullness <= 25 ? "hungry" : "ok";
  if (level === S.lastHungerLevel) return;
  if (level === "ok") {
    S.lastHungerLevel = "ok";
    return;
  }
  if (!S.bubble || els.bubble.classList.contains("show")) return;
  const lines = C.HUNGER_LINES && C.HUNGER_LINES[level];
  if (!lines || !lines.length) return;
  S.lastHungerLevel = level;
  S.bubble.show(pick(lines), { duration: 6200 });
}

function wireApi() {
  const api = S.api;
  api.connect({
    onState: onLiveState,
    onStatus: setConnected
  });
}

function startTimers() {
  clearInterval(S._heartbeat);
  S._heartbeat = setInterval(async () => {
    if (!S.api || S.api.offline) return;
    const body = await S.api.heartbeat(document.visibilityState === "visible");
    if (body && body.state) {
      if (!S.state || body.state.rev >= S.state.rev) {
        S.state = body.state;
        render();
      }
    }
  }, 15000);
  if (!S._visBound) {
    S._visBound = true;
    document.addEventListener("visibilitychange", () => {
      if (!S.api || S.api.offline) return;
      S.api.action("heartbeat", { visible: document.visibilityState === "visible" }).catch(() => {});
    });
  }
}

function startRetry() {
  clearInterval(S.retryTimer);
  S.retryTimer = setInterval(async () => {
    if (!S.api) return;
    try {
      const state = await S.api.state();
      S.api.offline = false;
      S.api.connect({ onState: onLiveState, onStatus: setConnected });
      applyState(state);
      startTimers();
      clearInterval(S.retryTimer);
      toast("又连上啦", 1600);
    } catch (_) {
      /* keep trying quietly */
    }
  }, 9000);
}

function showAuth(bootstrap) {
  if (bootstrap) S.bootstrap = bootstrap;
  els.auth.classList.remove("hidden");
  setAuthMode("login");
  finishBoot();
  setTimeout(() => els.authUser.focus(), 120);
}

function setAuthMode(mode) {
  S.authMode = mode;
  els.authTabs.forEach((tab) => {
    const on = tab.dataset.mode === mode;
    tab.classList.toggle("active", on);
    tab.setAttribute("aria-selected", on ? "true" : "false");
  });
  els.authPass2.classList.toggle("hidden", mode !== "register");
  els.authBtn.textContent = mode === "register" ? "创建账号" : "登录";
  els.authError.textContent = "";
  els.authError.classList.remove("ok");
  els.authPass.autocomplete = mode === "register" ? "new-password" : "current-password";
}

/* --------------------------------------------------------------- events */

function bindEvents() {
  els.petZone.addEventListener("pointerdown", onPointerDown);
  els.petZone.addEventListener("pointermove", onPointerMove);
  els.petZone.addEventListener("pointerup", onPointerUp);
  els.petZone.addEventListener("pointercancel", onPointerCancel);
  els.petZone.addEventListener("contextmenu", onContextMenu);
  els.petZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPetTap();
    }
  });

  [els.dockFeed, els.mFeed].forEach((b) => b && b.addEventListener("click", openFeed));
  [els.dockOuting, els.mOuting].forEach((b) => b && b.addEventListener("click", openOuting));
  [els.dockExercise, els.mExercise].forEach((b) => b && b.addEventListener("click", openExercise));
  [els.bgBtn, els.dockBackground].forEach((b) => b && b.addEventListener("click", openBackground));
  [els.dockProfile, els.mProfile, els.openProfileTop].forEach(
    (b) => b && b.addEventListener("click", () => Shell.openProfile())
  );

  if (els.sceneLamp) {
    els.sceneLamp.addEventListener("click", openSleepConfirm);
    els.sceneLamp.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openSleepConfirm();
      }
    });
  }
  els.awayEarly.addEventListener("click", askEarlyBack);
  els.awayPeek.addEventListener("click", peekAway);
  els.exerciseEarly.addEventListener("click", stopExerciseNow);
  els.exercisePeek.addEventListener("click", peekExercise);

  els.authTabs.forEach((tab) => tab.addEventListener("click", () => setAuthMode(tab.dataset.mode)));
  els.authBtn.addEventListener("click", submitAuth);
  [els.authUser, els.authPass, els.authPass2].forEach((input) => {
    input.addEventListener("input", () => { els.authError.textContent = ""; });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitAuth();
    });
  });

  els.sheetBackdrop.addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (S.menuOpen) closeMenu();
      else if (S.recapOpen) closeRecap();
      else if (S.sheetOpen) closeSheet();
    }
  });
  document.addEventListener("click", (e) => {
    if (S.menuOpen && !els.ctxMenu.contains(e.target)) closeMenu();
  });
  document.addEventListener("contextmenu", (e) => {
    if (!isElectron) e.preventDefault();
  });
  window.addEventListener("blur", () => {
    if (S.menuOpen) closeMenu();
  });

  if (isElectron) {
    window.addEventListener("mousemove", (e) => scheduleHitTest(e.clientX, e.clientY), { passive: true });
    const unlock = () => S.sfx.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
  } else {
    window.addEventListener("pointerdown", () => S.sfx.unlock(), { once: true });
  }

  window.addEventListener("resize", () => {
    if (S.menuOpen) closeMenu();
  });
}

/* --------------------------------------------------------------- tap */

function onPointerDown(e) {
  if (e.button === 2) return;
  S.press = {
    id: e.pointerId,
    x: e.clientX,
    y: e.clientY,
    sx: e.screenX,
    sy: e.screenY,
    time: performance.now(),
    moved: false,
    longPress: null
  };
  try {
    els.petZone.setPointerCapture(e.pointerId);
  } catch (_) {
    /* ignore */
  }
  if (!isElectron) {
    S.press.longPress = setTimeout(() => {
      if (S.press && !S.press.moved) {
        S.press.longPressed = true;
        S.sfx.play("open");
        Shell.openProfile();
      }
    }, 680);
  }
}

function onPointerMove(e) {
  const press = S.press;
  if (!press || press.id !== e.pointerId) return;
  const dist = Math.hypot(e.clientX - press.x, e.clientY - press.y);
  if (!isElectron) {
    if (dist > 8) {
      press.moved = true;
      clearTimeout(press.longPress);
    }
    return;
  }
  if (!press.moved && dist > 5) {
    press.moved = true;
    S.dragging = true;
    els.petZone.classList.add("dragging");
    Shell.setIgnore(false);
    Shell.dragStart();
  }
  if (press.moved) Shell.dragMove(e.screenX, e.screenY);
}

function onPointerUp(e) {
  const press = S.press;
  if (!press || press.id !== e.pointerId) return;
  clearTimeout(press.longPress);
  S.press = null;
  if (press.moved && isElectron) {
    S.dragging = false;
    els.petZone.classList.remove("dragging");
    Shell.dragEnd();
    return;
  }
  if (press.longPressed) return;
  if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 12) return;
  onPetTap();
}

function onPointerCancel() {
  const press = S.press;
  if (press) clearTimeout(press.longPress);
  if (S.dragging && isElectron) {
    Shell.dragEnd();
  }
  S.press = null;
  S.dragging = false;
  els.petZone.classList.remove("dragging");
}

function onPetTap() {
  if (S.dragging) return;
  if (!S.state) return;
  if (S.state.sleeping) {
    S.bubble.show(pick(C.SLEEP_MURMURS), { duration: 3200 });
    return;
  }
  if (S.state.exercise) {
    peekExercise();
    return;
  }
  if (S.state.outing) {
    peekAway();
    return;
  }
  const now = performance.now();
  S.combo = now - S.lastTapAt < 1150 ? S.combo + 1 : 1;
  S.lastTapAt = now;
  S.burstCount += 1;
  S.sfx.play("tap", S.combo);

  if (S.combo >= 2) {
    const spam = E.spamText(S.combo, C);
    S.bubble.show(spam.dots, { dots: true, mark: spam.mark, duration: 3200 });
    els.petBody.classList.remove("boop");
    void els.petBody.offsetWidth;
    els.petBody.classList.add("shake");
    setTimeout(() => els.petBody.classList.remove("shake"), 420);
    if (S.combo >= 4) burst(els.fxLayer, "dizzy", Math.min(4, Math.floor(S.combo / 3)), { y: -20 });
  } else {
    const line =
      S.lastBurstCount >= 6 && now - S.lastBurstAt < 9000
        ? pick(C.TAP_LINES.after_spam)
        : E.tapLine(S.state, C, Date.now());
    S.bubble.show(line, { duration: 5600 });
    els.petBody.classList.remove("boop", "pout");
    void els.petBody.offsetWidth;
    els.petBody.classList.add("boop");
    setTimeout(() => els.petBody.classList.remove("boop"), 500);
    burst(els.fxLayer, S.state.mood >= 70 ? "happy" : "hearts", 3, { y: -10 });
  }

  clearTimeout(S.burstTimer);
  S.burstTimer = setTimeout(flushBurst, 1050);
}

function flushBurst() {
  const count = S.burstCount;
  S.burstCount = 0;
  if (!count || !S.api || S.api.offline) return;
  S.lastBurstCount = count;
  S.lastBurstAt = performance.now();
  S.api
    .action("tap", { count })
    .then((body) => {
      if (body && body.state) applyState(body.state);
    })
    .catch(() => {
      maybeOfflineToast();
    });
}

/* --------------------------------------------------------------- state */

function applyState(state, soundHint = true) {
  if (!state) return;
  if (S.state && Number.isFinite(state.rev) && state.rev < S.state.rev) return;
  S.state = state;
  if (S.api) S.api.saveState(state);
  render(soundHint);
  maybeShowSummary();
}

function render() {
  if (!S.state) return;
  const s = S.state;
  const mood = E.moodLabel(s.mood, C);
  const days = E.daysTogether(s, Date.now());
  const todaySec = (s.daily && s.daily[s.today] && s.daily[s.today].activeSeconds) || 0;

  if (els.topName) els.topName.textContent = s.name || C.DEFAULT_NAME;
  if (els.topSub) els.topSub.textContent = `第 ${days} 天 · 今天陪了 ${fmtDuration(todaySec)}`;
  if (els.topMoodEmoji) els.topMoodEmoji.textContent = mood.emoji;
  if (els.topMoodValue) els.topMoodValue.textContent = Math.round(s.mood);
  if (els.topMood) els.topMood.title = `${mood.label} · ${mood.note}`;
  document.title = `${s.name || C.DEFAULT_NAME} · 桌宠`;
  document.body.classList.toggle("is-sleeping", !!s.sleeping);
  if (els.petImg) els.petImg.src = s.sleeping ? "/assets/pet-sleep.png" : "/assets/pet.png";
  if (els.statusText && S.connected) {
    els.statusText.textContent = s.sleeping ? "她睡着了 · 云端同步中" : "云端同步中 · 长按打开手账";
  }

  renderScene();
  renderAway();
  renderExercise();
  maybeHungerNotice(s);
  if (!!s.sleeping !== S.lastSleeping) {
    S.lastSleeping = !!s.sleeping;
    if (S.bubble) {
      S.bubble.show(s.sleeping ? "晚安。……灯我关掉了，你也早点休息。" : "唔……我醒啦。现在是什么时候？", { duration: 5200 });
    }
  }
}

function renderScene() {
  const s = S.state;
  const scene = C.SCENES.find((sc) => sc.id === (s && s.background)) || C.SCENES[0];
  document.body.dataset.scene = scene.id;
  const lamp = document.querySelector(".scene-lamp");
  const plant = document.querySelector(".scene-plant");
  if (lamp) lamp.src = s && s.sleeping ? "/assets/lamp-off.png" : "/assets/lamp-on.png";
  if (plant) plant.textContent = scene.id === "garden" ? "🌷" : "🪴";
}

function onLiveState(state) {
  applyState(state, false);
  if (state && state.outing && !S.awayTimer) renderAway();
}

function setConnected(online) {
  S.connected = !!online;
  if (S.api) S.api.offline = !online;
  if (els.syncDot) {
    els.syncDot.classList.toggle("offline", !online);
    els.syncDot.title = online ? "已同步" : "离线，正在重连";
  }
  if (els.statusDot) els.statusDot.classList.toggle("offline", !online);
  if (els.statusText) {
    els.statusText.textContent = online
      ? "云端同步中 · 长按打开手账"
      : "离线 · 正在重连";
  }
}

function maybeOfflineToast() {
  const now = Date.now();
  if (now - S.lastOfflineToast < 6000) return;
  S.lastOfflineToast = now;
  toast("连不上小屋，等会儿再试试", 2400);
}

/* --------------------------------------------------------------- away */

function renderAway() {
  const s = S.state;
  if (!s || !s.outing) {
    els.awayCard.classList.add("hidden");
    document.body.classList.remove("is-away");
    clearInterval(S.awayTimer);
    S.awayTimer = null;
    S.awayFinishing = false;
    return;
  }
  const outing = s.outing;
  els.awayCard.classList.remove("hidden");
  document.body.classList.add("is-away");
  S.bubble.hide();
  els.awayEmoji.textContent = outing.emoji || "🌳";
  els.awayTitle.textContent = `去${outing.name}走走`;
  els.awayNote.textContent = "不用等她，她会自己看时间。回来时会带一点小东西。";
  els.awayScene.className = `away-scene scene-${outing.scene || "park"}`;
  els.awayScene.dataset.place = outing.placeId || "park";
  updateAwayCount();
  clearInterval(S.awayTimer);
  S.awayTimer = setInterval(updateAwayCount, 1000);
}

function updateAwayCount() {
  const s = S.state;
  if (!s || !s.outing) return;
  const left = s.outing.endsAt - Date.now();
  els.awayCount.textContent = fmtClock(Math.max(0, left));
  if (left <= 0 && !S.awayFinishing) {
    S.awayFinishing = true;
    clearInterval(S.awayTimer);
    S.awayTimer = null;
    setTimeout(finishAway, 700);
  }
}

async function finishAway() {
  if (!S.api) return;
  try {
    const state = await S.api.state();
    applyState(state);
    S.awayFinishing = false;
    if (state.outing) {
      // clock skew: check again a little later
      S.awayTimer = setInterval(updateAwayCount, 1000);
    }
  } catch (_) {
    S.awayFinishing = false;
    S.awayTimer = setInterval(updateAwayCount, 1000);
  }
}

function peekAway() {
  if (!S.state || !S.state.outing) return;
  const outing = S.state.outing;
  const place = C.OUTINGS.find((p) => p.id === outing.placeId);
  const line = pick((place && place.peek) || [
    "这里的风很好。我坐一会儿就回去。",
    "我很好，不用一直看时间。",
    "刚刚看到一朵很像你的云。"
  ]);
  S.bubble.show(line, { duration: 3800 });
  S.sfx.play("open");
}

function askEarlyBack() {
  if (!S.state || !S.state.outing) return;
  confirmDialog({
    kicker: "EARLY BACK",
    title: "要提前回来吗？",
    text: "她还没逛完。提前回来只能拿到一部分心情值，不过……她应该会想见你。",
    okText: "让她回来",
    cancelText: "再等等",
    onOk: async () => {
      try {
        const body = await S.api.action("outing_finish", { early: true });
        applyState(body.state);
        if (body.result && body.result.ok && !body.result.cancelled) {
          S.sfx.play("feed");
          showRecap(body.result);
        } else if (body.result) {
          S.bubble.show(body.result.line, { duration: 4200 });
        }
      } catch (err) {
        toast(err.message === "not_away" ? "她已经回来了" : "现在还说不上话", 2200);
      }
    }
  });
}

/* --------------------------------------------------------------- exercise */

function renderExercise() {
  const s = S.state;
  if (!s || !s.exercise) {
    if (els.exerciseCard) els.exerciseCard.classList.add("hidden");
    document.body.classList.remove("is-exercising");
    clearInterval(S.exerciseTimer);
    S.exerciseTimer = null;
    S.exerciseFinishing = false;
    stopExerciseFx();
    return;
  }
  const ex = s.exercise;
  els.exerciseCard.classList.remove("hidden");
  els.awayCard.classList.add("hidden");
  document.body.classList.add("is-exercising");
  document.body.classList.remove("is-away");
  els.exerciseEmoji.textContent = ex.emoji || "🏃";
  els.exerciseScene.dataset.kind = ex.kindId || "run";
  els.exerciseKicker.textContent = "运动中 · 挥汗如雨";
  els.exerciseTitle.textContent = `正在${ex.name}`;
  els.exerciseNote.textContent = pick(C.EXERCISE_STATUS_LINES[ex.kindId] || ["正在运动。先别打扰她。"]);
  startExerciseFx(ex);
  updateExerciseCount();
  clearInterval(S.exerciseTimer);
  S.exerciseTimer = setInterval(updateExerciseCount, 1000);
}

function startExerciseFx(ex) {
  const kind = ex.kindId || "run";
  if (S.exerciseFxKind === kind) return;
  stopExerciseFx();
  S.exerciseFxKind = kind;
  document.body.dataset.exercise = kind;
  S.exerciseSweatTimer = setInterval(() => {
    if (!S.state || !S.state.exercise) return;
    const drop = document.createElement("span");
    drop.className = "sweat-drop";
    drop.textContent = kind === "stretch" ? "✦" : "💧";
    drop.style.left = `${38 + Math.random() * 26}%`;
    drop.style.top = `${38 + Math.random() * 18}%`;
    drop.style.animationDelay = `${Math.random() * 120}ms`;
    els.fxLayer.appendChild(drop);
    setTimeout(() => drop.remove(), 1400);
  }, kind === "rope" ? 520 : 680);
  S.exerciseFlavorTimer = setInterval(() => {
    if (!S.state || !S.state.exercise) return;
    els.exerciseNote.textContent = pick(C.EXERCISE_STATUS_LINES[kind] || ["正在运动。先别打扰她。"]);
  }, 2600);
}

function stopExerciseFx() {
  if (S.exerciseSweatTimer) clearInterval(S.exerciseSweatTimer);
  if (S.exerciseFlavorTimer) clearInterval(S.exerciseFlavorTimer);
  S.exerciseSweatTimer = null;
  S.exerciseFlavorTimer = null;
  S.exerciseFxKind = "";
  document.body.removeAttribute("data-exercise");
  els.fxLayer.querySelectorAll(".sweat-drop").forEach((n) => n.remove());
}

function updateExerciseCount() {
  const s = S.state;
  if (!s || !s.exercise) return;
  const left = s.exercise.endsAt - Date.now();
  els.exerciseCount.textContent = fmtClock(Math.max(0, left));
  if (left <= 0 && !S.exerciseFinishing) {
    S.exerciseFinishing = true;
    clearInterval(S.exerciseTimer);
    S.exerciseTimer = null;
    setTimeout(finishExerciseAuto, 750);
  }
}

async function finishExerciseAuto() {
  if (!S.api) return;
  try {
    const state = await S.api.state();
    applyState(state);
    S.exerciseFinishing = false;
    if (state.exercise) S.exerciseTimer = setInterval(updateExerciseCount, 1000);
  } catch (_) {
    S.exerciseFinishing = false;
    S.exerciseTimer = setInterval(updateExerciseCount, 1000);
  }
}

function peekExercise() {
  if (!S.state || !S.state.exercise) return;
  const ex = S.state.exercise;
  const line = pick(C.EXERCISE_STATUS_LINES[ex.kindId] || ["正在运动，先别打扰我。"]);
  toast(line, 3600);
  S.sfx.play("tap", 2);
}

async function stopExerciseNow() {
  if (!S.state || !S.state.exercise || S.pending) return;
  S.pending = true;
  els.exerciseEarly.disabled = true;
  try {
    const body = await S.api.action("exercise_finish", { early: true });
    applyState(body.state);
    if (body.result && body.result.ok) {
      S.sfx.play("feed");
      showExerciseSummary(body.result);
    }
  } catch (err) {
    toast(err.message === "not_exercising" ? "她已经停下来了" : "现在还说不上话", 2200);
  } finally {
    S.pending = false;
    els.exerciseEarly.disabled = false;
  }
}

function askStopExercise() {
  if (!S.state || !S.state.exercise) return;
  const ex = S.state.exercise;
  confirmDialog({
    kicker: "TAKE A BREAK",
    title: "要让她停下吗？",
    text: `她正在${ex.name}。现在停下只能拿到一部分健康值，不过运动记录会留下来。`,
    okText: "让她停下",
    cancelText: "再坚持一下",
    onOk: async () => {
      try {
        const body = await S.api.action("exercise_finish", { early: true });
        applyState(body.state);
        if (body.result && body.result.ok) {
          S.sfx.play("feed");
          showExerciseSummary(body.result);
        }
      } catch (err) {
        toast(err.message === "not_exercising" ? "她已经停下来了" : "现在还说不上话", 2200);
      }
    }
  });
}

function showExerciseSummary(result) {
  if (!result) return;
  S.summaryType = "exercise";
  S.recapOpen = true;
  S.recapKey = result.at;
  S.bubble.hide();
  const health = Number(result.healthDelta) || 0;
  const fatigue = Number(result.fatigueDelta) || 0;
  const mood = Number(result.moodDelta) || 0;
  els.modalLayer.innerHTML = `
    <div class="recap" role="dialog" aria-modal="true" aria-label="运动记录">
      <div class="recap-head">
        <div class="r-kicker">${result.early ? "CUT SHORT" : "EXERCISE NOTE"}</div>
        <div class="r-place">${result.emoji || "🏃"} ${escapeHtml(result.name || "运动")}</div>
        <div class="r-time">${escapeHtml(fmtDate(result.at || Date.now()))} · ${result.actualMinutes || result.minutes} 分钟</div>
        <div class="stamp">SWEAT</div>
      </div>
      <div class="recap-body">
        <div class="recap-emoji">${result.emoji || "🏃"}</div>
        <p class="recap-line">${escapeHtml(result.line || "运动完了。")}</p>
        <div class="recap-stats">
          <span class="chip">健康 +${health}</span>
          <span class="chip">疲惫 +${fatigue}</span>
          <span class="chip">心情 +${mood}</span>
          ${result.early ? '<span class="chip">提前停下</span>' : ""}
        </div>
        <div class="recap-stamp">
          <div>
            <div class="s-label">运动记录</div>
            <div class="s-value">${result.early ? "已记录 · 下次慢慢来" : "已写进手账"}</div>
          </div>
          <button class="btn small primary" id="recapOk">收好</button>
        </div>
      </div>
    </div>`;
  els.modalLayer.classList.add("open");
  els.modalLayer.setAttribute("aria-hidden", "false");
  S.sfx.play("recap");
  $("#recapOk", els.modalLayer).addEventListener("click", closeRecap);
  els.modalLayer.onclick = (e) => {
    if (e.target === els.modalLayer) closeRecap();
  };
}

/* --------------------------------------------------------------- recap */

function maybeShowSummary() {
  if (!S.booted || S.recapOpen) return;
  const s = S.state;
  if (!s) return;
  if (s.lastExercise && s.lastExercise.unseen) {
    const key = s.lastExercise.at;
    if (S.recapKey !== key) {
      showExerciseSummary(s.lastExercise);
      return;
    }
  }
  if (s.lastOuting && s.lastOuting.unseen) {
    const key = s.lastOuting.at;
    if (S.recapKey !== key) showRecap(s.lastOuting);
  }
}

function showRecap(result) {
  if (!result || result.cancelled) return;
  S.summaryType = "outing";
  S.recapOpen = true;
  S.recapKey = result.at;
  S.bubble.hide();
  const mood = Number(result.moodDelta) || 0;
  const full = Number(result.fullnessDelta) || 0;
  els.modalLayer.innerHTML = `
    <div class="recap" role="dialog" aria-modal="true" aria-label="出游手账">
      <div class="recap-head">
        <div class="r-kicker">${result.early ? "EARLY BACK" : "TRAVEL NOTE"}</div>
        <div class="r-place">${escapeHtml(result.name || "出门走走")}</div>
        <div class="r-time">${escapeHtml(fmtDate(result.at || Date.now()))} · ${result.actualMinutes || result.minutes} 分钟</div>
        <div class="stamp">${result.early ? "EARLY" : "MOMO"}</div>
      </div>
      <div class="recap-body">
        <div class="recap-emoji">${result.emoji || "🌿"}</div>
        <p class="recap-line">${escapeHtml(result.line || "我回来了。")}</p>
        ${result.surprise ? `<p class="recap-surprise">路上遇到：${escapeHtml(result.surprise)}</p>` : ""}
        <div class="recap-stats">
          <span class="chip">心情 ${mood >= 0 ? "+" : ""}${mood}</span>
          <span class="chip">饱腹 −${full}</span>
          ${result.early ? '<span class="chip">提前回家</span>' : ""}
        </div>
        <div class="recap-stamp">
          <div>
            <div class="s-label">带回来的小东西</div>
            <div class="s-value">${result.souvenir || "🍃"} ${result.early ? "一片还没干的叶子" : "放进了手账"}</div>
          </div>
          <button class="btn small primary" id="recapOk">收好</button>
        </div>
      </div>
    </div>`;
  els.modalLayer.classList.add("open");
  els.modalLayer.setAttribute("aria-hidden", "false");
  S.sfx.play("recap");
  const ok = $("#recapOk", els.modalLayer);
  ok.addEventListener("click", closeRecap);
  els.modalLayer.onclick = (e) => {
    if (e.target === els.modalLayer) closeRecap();
  };
}

function closeRecap() {
  if (!S.recapOpen) return;
  S.recapOpen = false;
  els.modalLayer.classList.remove("open");
  els.modalLayer.setAttribute("aria-hidden", "true");
  setTimeout(() => {
    if (!S.recapOpen) els.modalLayer.innerHTML = "";
  }, 240);
  const type = S.summaryType;
  if (S.api && S.state) {
    const unseen = type === "exercise"
      ? S.state.lastExercise && S.state.lastExercise.unseen
      : S.state.lastOuting && S.state.lastOuting.unseen;
    if (unseen) {
      S.api.action(type === "exercise" ? "exercise_seen" : "outing_seen", {}).then((body) => {
        if (body && body.state) applyState(body.state);
      }).catch(() => {});
    }
  }
}

/* --------------------------------------------------------------- pair */

async function submitAuth() {
  const username = els.authUser.value.trim();
  const password = els.authPass.value;
  const confirm = els.authPass2.value;
  if (username.length < 2) {
    els.authError.textContent = "账号至少 2 个字符";
    return;
  }
  if (password.length < 6) {
    els.authError.textContent = "密码至少 6 位";
    return;
  }
  if (S.authMode === "register" && password !== confirm) {
    els.authError.textContent = "两次输入的密码不一样";
    return;
  }
  els.authBtn.disabled = true;
  els.authBtn.textContent = S.authMode === "register" ? "正在布置小屋…" : "正在开门…";
  els.authError.textContent = "";
  try {
    const api = await Api.auth(username, password, S.authMode, S.bootstrap);
    if (S.authMode === "register") {
      await api.logout();
      Api.clearAuth();
      setAuthMode("login");
      els.authUser.value = username;
      els.authPass.value = "";
      els.authPass2.value = "";
      els.authError.classList.add("ok");
      els.authError.textContent = "账号创建成功，请输入密码登录。";
      els.authPass.focus();
      els.authBtn.disabled = false;
      return;
    }
    S.api = api;
    const state = await api.state();
    els.auth.classList.add("hidden");
    applyState(state, false);
    setConnected(true);
    wireApi();
    startTimers();
    S.booted = true;
    maybeShowSummary();
    toast(S.authMode === "register" ? "小屋建好了，她住进来啦" : "欢迎回来，她在等你", 2400);
    S.sfx.play("recap");
    setTimeout(firstTip, 2200);
  } catch (err) {
    const map = {
      wrong_credentials: "账号或密码不对",
      username_taken: "这个账号已经有人用了",
      bad_username: "账号要 2-20 个字符，可以用中文、字母、数字、_ 或 -",
      bad_password: "密码至少 6 位，最多 72 位",
      too_many_tries: "试太多次啦，等十分钟再来",
      network: "连不上这台电脑",
      auth_failed: "没有成功，再试一次吧"
    };
    els.authError.classList.remove("ok");
    els.authError.textContent = map[err.message] || "没有成功，再试一次吧";
    els.authBtn.disabled = false;
    els.authBtn.textContent = S.authMode === "register" ? "创建并进入小屋" : "登录";
  }
}

/* --------------------------------------------------------------- sheets */

function openSheet({ title, subtitle = "", body, foot, onOpen }) {
  closeMenu();
  S.sheetOpen = true;
  els.sheet.innerHTML = `
    <div class="sheet-grab" aria-hidden="true"></div>
    <div class="sheet-head">
      <div>
        <h2>${escapeHtml(title)}</h2>
        ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
      </div>
      <button class="sheet-close" aria-label="关闭" id="sheetClose">✕</button>
    </div>
    <div class="sheet-body"></div>
    ${foot ? '<div class="sheet-foot"></div>' : ""}
  `;
  const bodyHost = $(".sheet-body", els.sheet);
  bodyHost.appendChild(body);
  if (foot) $(".sheet-foot", els.sheet).appendChild(foot);
  els.sheetHost.classList.add("open");
  els.sheetHost.setAttribute("aria-hidden", "false");
  if (isElectron) Shell.setIgnore(false);
  $("#sheetClose", els.sheet).addEventListener("click", closeSheet);
  if (onOpen) onOpen();
}

function closeSheet() {
  if (!S.sheetOpen) return;
  S.sheetOpen = false;
  els.sheetHost.classList.remove("open");
  els.sheetHost.setAttribute("aria-hidden", "true");
  setTimeout(() => {
    if (!S.sheetOpen) els.sheet.innerHTML = "";
  }, 330);
  if (isElectron) setTimeout(() => hitTestNow(), 340);
}

function openSleepConfirm() {
  if (!S.state) return;
  const sleeping = !!S.state.sleeping;
  const body = el("div");
  const p = el("p", "hint-line");
  p.textContent = sleeping
    ? "灯还暗着。她睡得很轻，要现在叫醒她吗？"
    : "灯要关掉了。她大概会揉揉眼睛，然后慢慢睡着。";
  body.appendChild(p);
  const foot = el("div");
  foot.style.display = "flex";
  foot.style.gap = "10px";
  const cancel = el("button", "btn small ghost", sleeping ? "再睡会儿" : "再玩会儿");
  const ok = el("button", "btn small primary", sleeping ? "叫醒" : "睡吧");
  cancel.type = "button";
  ok.type = "button";
  foot.appendChild(cancel);
  foot.appendChild(ok);
  openSheet({
    title: sleeping ? "要叫醒她吗？" : "嗯？要睡了吗",
    subtitle: sleeping ? "她还在梦里" : "灯一关，她就知道该休息了",
    body,
    foot
  });
  cancel.addEventListener("click", closeSheet);
  ok.addEventListener("click", async () => {
    ok.disabled = true;
    ok.textContent = "……";
    try {
      const res = await S.api.action("set_sleeping", { sleeping: !sleeping });
      applyState(res.state);
      closeSheet();
      toast(sleeping ? "叫醒她了，早呀。" : "灯关了，晚安。", 2200);
    } catch (err) {
      ok.disabled = false;
      ok.textContent = sleeping ? "叫醒" : "睡吧";
      toast(err && err.message === "busy" ? "她还在外面或运动中，等会儿再睡吧" : "现在睡不着，等会儿再试", 2400);
    }
  });
}

function openFeed() {
  if (!S.state) return;
  if (S.state.sleeping) {
    toast("她睡着了，先点台灯叫醒她吧", 2200);
    return;
  }
  if (S.state.outing) {
    toast("她还在外面，回来再喂吧", 2200);
    return;
  }
  if (S.state.exercise) {
    toast("她正在运动，等会儿再吃吧", 2200);
    return;
  }
  S.sfx.play("open");
  let itemSel = null;
  let optionSel = null;
  const body = el("div");
  const footBtn = el("button", "btn primary", "选一样吃的吧");
  footBtn.disabled = true;

  const foodGroups = (C.FEED_CATEGORIES || [{ id: "", title: "食物", note: "" }]).map((cat) => ({
    ...cat,
    items: C.FEED.filter((item) => (item.category || "") === cat.id)
      .sort((a, b) => (a.order == null ? 999 : a.order) - (b.order == null ? 999 : b.order))
  }));
  foodGroups.forEach((group) => {
    if (!group.items.length) return;
    const head = el("div", "food-section-head");
    head.dataset.kind = group.id;
    head.innerHTML = `<span>${escapeHtml(group.title)}</span>${group.note ? `<em>${escapeHtml(group.note)}</em>` : ""}`;
    body.appendChild(head);
    group.items.forEach((item) => {
    const row = el("button", "food-row");
    row.type = "button";
    row.innerHTML = `
      <span class="f-emoji">${item.emoji}</span>
      <span class="f-main">
        <span class="f-name">${escapeHtml(item.name)}</span>
        <span class="f-hint">${escapeHtml(item.hint)}</span>
      </span>
      <span class="f-chev">＋</span>`;
    const block = el("div", "option-block");
    block.innerHTML = `<div class="option-label">${escapeHtml(item.name)} · ${escapeHtml(item.hint)}</div>`;
    const grid = el("div", "option-grid");
    item.options.forEach((opt) => {
      const chip = el("button", "option-chip", escapeHtml(opt.label));
      chip.type = "button";
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        optionSel = opt;
        grid.querySelectorAll(".option-chip").forEach((n) => n.classList.toggle("active", n === chip));
        footBtn.disabled = false;
        footBtn.textContent = `把${item.name}（${opt.label}）喂给她`;
      });
      grid.appendChild(chip);
    });
    block.appendChild(grid);
    const wrap = el("div", "food-wrap");
    wrap.appendChild(row);
    wrap.appendChild(block);
    body.appendChild(wrap);

    row.addEventListener("click", () => {
      body.querySelectorAll(".food-row").forEach((n) => n.classList.toggle("active", n === row));
      body.querySelectorAll(".option-block").forEach((n) => n.classList.toggle("open", n === block));
      itemSel = item;
      optionSel = null;
      footBtn.disabled = true;
      footBtn.textContent = `选一个${item.hint.replace("要", "")}`;
    });
    });
  });

  const hint = el(
    "div",
    "hint-line",
    "她不会说很多漂亮话，但会认真尝。吃太饱的话，可能会吃不下哦。"
  );
  body.prepend(hint);

  footBtn.addEventListener("click", async () => {
    if (!itemSel || !optionSel || S.pending) return;
    S.pending = true;
    footBtn.disabled = true;
    footBtn.textContent = "她正在吃…";
    try {
      const res = await S.api.action("feed", { itemId: itemSel.id, optionId: optionSel.id });
      closeSheet();
      applyState(res.state);
      const r = res.result || {};
      if (r.refused) {
        els.petBody.classList.add("pout");
        setTimeout(() => els.petBody.classList.remove("pout"), 640);
        S.sfx.play("error");
        S.bubble.show(r.line, { duration: 5200 });
        moodToast("她真的吃不下了", "bad");
      } else {
        foodFly(els.fxLayer, itemSel.emoji);
        els.petBody.classList.add("chew");
        setTimeout(() => els.petBody.classList.remove("chew"), 1100);
        S.sfx.play("feed");
        S.bubble.show(r.line, { duration: 6200 });
        const delta = Number(r.moodDelta) || 0;
        const health = Number(r.healthDelta) || 0;
        const full = Number(r.fullnessDelta) || 0;
        const sign = (n) => `${n > 0 ? "+" : ""}${Math.round(n * 10) / 10}`;
        moodToast(`心情 ${sign(delta)} · 饱食 ${sign(full)} · 健康 ${sign(health)}`, health < 0 ? "bad" : undefined);
      }
    } catch (err) {
      footBtn.disabled = false;
      footBtn.textContent = "再试一次";
      if (err.message === "away") {
        closeSheet();
        toast("她还在外面呢", 2200);
      } else if (err.message === "busy") {
        closeSheet();
        toast("她正在运动，等会儿再吃吧", 2200);
      } else {
        maybeOfflineToast();
      }
    } finally {
      S.pending = false;
    }
  });

  openSheet({
    title: "投喂",
    subtitle: "先看看她想吃什么",
    body,
    foot: footBtn
  });
}

function openOuting() {
  if (!S.state) return;
  if (S.state.sleeping) {
    toast("她睡着了，先点台灯叫醒她吧", 2200);
    return;
  }
  if (S.state.outing) {
    renderAway();
    toast("她已经出门啦", 2000);
    return;
  }
  if (S.state.exercise) {
    toast("她正在运动，先让她动完吧", 2200);
    return;
  }
  S.sfx.play("open");
  let place = C.OUTINGS.find((p) => p.id === (S.state.lastOuting && S.state.lastOuting.placeId)) || C.OUTINGS[0];
  let minutes = 10;
  const body = el("div");

  const grid = el("div", "place-grid");
  C.OUTINGS.forEach((p) => {
    const card = el("button", "place-card");
    card.type = "button";
    card.innerHTML = `
      <div class="p-emoji">${p.emoji}</div>
      <div class="p-name">${escapeHtml(p.name)}</div>
      <div class="p-blurb">${escapeHtml(p.blurb)}</div>`;
    card.classList.toggle("active", p.id === place.id);
    card.addEventListener("click", () => {
      place = p;
      grid.querySelectorAll(".place-card").forEach((n) => n.classList.toggle("active", n === card));
      updateHint();
    });
    grid.appendChild(card);
  });
  body.appendChild(grid);

  const preview = el("div", "place-preview");
  body.appendChild(preview);

  const durLabel = el("div", "option-label", "去多久？");
  body.appendChild(durLabel);
  const durations = el("div", "duration-row");
  [
    { value: 10, label: "10 分钟", note: "小小的散步" },
    { value: 30, label: "半小时", note: "走远一点" }
  ].forEach((d) => {
    const b = el("button", "duration", `${d.label}<small>${d.note}</small>`);
    b.type = "button";
    b.classList.toggle("active", d.value === minutes);
    b.addEventListener("click", () => {
      minutes = d.value;
      durations.querySelectorAll(".duration").forEach((n) => n.classList.toggle("active", n === b));
      updateHint();
    });
    durations.appendChild(b);
  });
  body.appendChild(durations);

  const hint = el("div", "hint-line");
  body.appendChild(hint);
  const updateHint = () => {
    const plan = place.durations[minutes];
    preview.textContent = `“${pick(place.preview || [place.blurb])}”`;
    hint.textContent = `去${place.name} ${minutes} 分钟，回来时心情大约 +${plan.mood}、疲惫 +${plan.fatigue != null ? plan.fatigue : minutes <= 10 ? 2 : 5}。她不在的时候，时间也会自己走。`;
  };
  updateHint();

  const foot = el("button", "btn primary", "让她出门");
  foot.addEventListener("click", async () => {
    if (S.pending) return;
    S.pending = true;
    foot.disabled = true;
    foot.textContent = "正在出门…";
    try {
      const res = await S.api.action("outing_start", { placeId: place.id, minutes });
      closeSheet();
      applyState(res.state);
      S.sfx.play("outing");
      toast(`她去${place.name}了，${minutes} 分钟后回来`, 2800);
      renderAway();
    } catch (err) {
      foot.disabled = false;
      foot.textContent = "再试一次";
      if (err.message === "already_away") {
        closeSheet();
        toast("她已经出门啦", 2200);
      } else if (err.message === "busy") {
        closeSheet();
        toast("她正在运动，先让她动完吧", 2200);
      } else {
        maybeOfflineToast();
      }
    } finally {
      S.pending = false;
    }
  });

  openSheet({
    title: "出门走走",
    subtitle: "她会自己看时间，也会带一点小东西回来",
    body,
    foot
  });
}

function openBackground() {
  if (!S.state) return;
  S.sfx.play("open");
  const current = S.state.background || "home";
  const body = el("div");
  body.appendChild(el("div", "hint-line", "换一个她现在待着的地方。背景会跟着账号同步到手机和电脑。"));
  const grid = el("div", "scene-grid");
  C.SCENES.forEach((sc) => {
    const chip = el("button", "scene-chip");
    chip.type = "button";
    chip.dataset.scene = sc.id;
    chip.classList.toggle("active", sc.id === current);
    chip.innerHTML = `<span class="s-emoji">${sc.emoji}</span><span><span class="s-name">${escapeHtml(sc.name)}</span><span class="s-desc">${escapeHtml(sc.subtitle)}</span></span>`;
    chip.addEventListener("click", async () => {
      if (chip.classList.contains("active")) {
        closeSheet();
        return;
      }
      try {
        const res = await S.api.action("set_background", { background: sc.id });
        applyState(res.state);
        closeSheet();
        toast(`换成${sc.name}了`, 1800);
      } catch (_) {
        toast("现在换不了背景", 1800);
      }
    });
    grid.appendChild(chip);
  });
  body.appendChild(grid);
  openSheet({ title: "小屋背景", subtitle: "她待着的地方", body });
}

function openExercise() {
  if (!S.state) return;
  if (S.state.sleeping) {
    toast("她睡着了，先点台灯叫醒她吧", 2200);
    return;
  }
  if (S.state.outing) {
    toast("她还在外面，回来再运动吧", 2200);
    return;
  }
  if (S.state.exercise) {
    renderExercise();
    toast("她已经在运动啦", 2000);
    return;
  }
  S.sfx.play("open");
  let kind = C.EXERCISES.find((e) => e.id === (S.state.lastExercise && S.state.lastExercise.kindId)) || C.EXERCISES[0];
  let minutes = 3;
  const body = el("div");

  const intro = el("div", "hint-line", "运动时不能打扰她，但可以中断。健康值会大量增加，疲惫值也会——记得让她休息。");
  body.appendChild(intro);

  const grid = el("div", "place-grid");
  C.EXERCISES.forEach((ex) => {
    const card = el("button", "place-card");
    card.type = "button";
    card.innerHTML = `
      <div class="p-emoji">${ex.emoji}</div>
      <div class="p-name">${escapeHtml(ex.name)}</div>
      <div class="p-blurb">${escapeHtml(ex.blurb)}</div>`;
    card.classList.toggle("active", ex.id === kind.id);
    card.addEventListener("click", () => {
      kind = ex;
      grid.querySelectorAll(".place-card").forEach((n) => n.classList.toggle("active", n === card));
      update();
    });
    grid.appendChild(card);
  });
  body.appendChild(grid);

  const preview = el("div", "place-preview");
  body.appendChild(preview);

  body.appendChild(el("div", "option-label", "运动多久？"));
  const rows = el("div", "duration-row");
  C.EXERCISE_DURATIONS.forEach((m) => {
    const b = el("button", "duration", `${m} 分钟${m === 30 ? "<small>很久</small>" : ""}`);
    b.type = "button";
    b.classList.toggle("active", m === minutes);
    b.addEventListener("click", () => {
      minutes = m;
      rows.querySelectorAll(".duration").forEach((n) => n.classList.toggle("active", n === b));
      update();
    });
    rows.appendChild(b);
  });
  body.appendChild(rows);

  const hint = el("div", "hint-line");
  body.appendChild(hint);

  let foot = null;
  const update = () => {
    const plan = kind.durations[minutes];
    preview.textContent = `“${pick(kind.preview)}”`;
    const fatigue = Number(S.state.fatigue) || 0;
    const warn = fatigue >= 70 ? " 她现在有点累，可能只能完成一部分。" : "";
    hint.textContent = `${kind.name} ${minutes} 分钟：健康 +${plan.health}，疲惫 +${plan.fatigue}，心情 +${plan.mood || 0}。${warn}`;
    if (foot) foot.textContent = `让${kind.name} ${minutes} 分钟`;
  };
  update();

  body.appendChild(el("div", "hint-line", `当前：健康 ${Math.round(S.state.health)} / 疲惫 ${Math.round(S.state.fatigue)}`));

  foot = el("button", "btn primary", `让${kind.name} ${minutes} 分钟`);

  foot.addEventListener("click", async () => {
    if (S.pending) return;
    S.pending = true;
    foot.disabled = true;
    foot.textContent = "她正在热身…";
    try {
      const res = await S.api.action("exercise_start", { kindId: kind.id, minutes });
      closeSheet();
      applyState(res.state);
      S.sfx.play("outing");
      toast(`她开始${kind.name}了，${minutes} 分钟后结束`, 2800);
      renderExercise();
    } catch (err) {
      foot.disabled = false;
      update();
      if (err.message === "already_exercising") {
        closeSheet();
        toast("她已经在运动啦", 2200);
      } else if (err.message === "away") {
        closeSheet();
        toast("她还在外面呢", 2200);
      } else if (err.message === "tired") {
        const line = (err.body && err.body.result && err.body.result.line) || "今天已经太累了，让我休息一会儿吧。";
        closeSheet();
        S.bubble.show(line, { duration: 5200 });
        S.sfx.play("error");
      } else {
        maybeOfflineToast();
      }
    } finally {
      S.pending = false;
    }
  });

  openSheet({
    title: "运动一下",
    subtitle: "跑步、跳绳、散步、拉伸，选一个",
    body,
    foot
  });
}

/* --------------------------------------------------------------- menu */

function onContextMenu(e) {
  if (!isElectron) return;
  e.preventDefault();
  openMenu(e.clientX, e.clientY);
}

function openMenu(x, y) {
  const exercising = !!(S.state && S.state.exercise);
  const baseItems = exercising
    ? [
        { id: "stopExercise", icon: "⏹", label: "中断运动", danger: true },
        { id: "exercisePeek", icon: "💧", label: "看看她" },
        { id: "profile", icon: "📔", label: "个人页面" },
        { sep: true }
      ]
    : [
        { id: "profile", icon: "📔", label: "个人页面" },
        { id: "feed", icon: "🧋", label: "喂她吃点" },
        { id: "outing", icon: "🎒", label: "出门走走" },
        { id: "exercise", icon: "🏃", label: "运动一下" },
        { id: "talk", icon: "💬", label: "和她说说话" },
        { sep: true }
      ];
  const standard = [
    { id: "sound", icon: S.settings.sound ? "🔊" : "🔇", label: S.settings.sound ? "声音：开" : "声音：关" },
    { id: "resetPos", icon: "⌖", label: "回到右下角" }
  ];
  const items = [...baseItems, ...standard];
  if (isElectron) {
    items.push({ sep: true });
    items.push({ id: "hide", icon: "—", label: "藏起来" });
    items.push({ id: "quit", icon: "×", label: "退出", danger: true });
  }
  els.ctxMenu.innerHTML = items
    .map((item) => {
      if (item.sep) return '<div class="ctx-sep"></div>';
      return `<button class="ctx-item ${item.danger ? "danger" : ""}" data-act="${item.id}" role="menuitem">
        <span class="ico">${item.icon}</span><span>${escapeHtml(item.label)}</span>
      </button>`;
    })
    .join("");
  els.ctxMenu.classList.remove("hidden");
  S.menuOpen = true;
  if (isElectron) Shell.setIgnore(false);
  const rect = els.ctxMenu.getBoundingClientRect();
  const px = clamp(x, 8, window.innerWidth - rect.width - 8);
  const py = clamp(y, 8, window.innerHeight - rect.height - 8);
  els.ctxMenu.style.left = `${px}px`;
  els.ctxMenu.style.top = `${py}px`;
  els.ctxMenu.querySelectorAll(".ctx-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const act = btn.dataset.act;
      closeMenu();
      switch (act) {
        case "profile":
          S.sfx.play("open");
          Shell.openProfile();
          break;
        case "feed":
          openFeed();
          break;
        case "outing":
          openOuting();
          break;
        case "exercise":
          openExercise();
          break;
        case "stopExercise":
          askStopExercise();
          break;
        case "exercisePeek":
          peekExercise();
          break;
        case "talk":
          if (S.state) {
            S.bubble.show(
              S.state.exercise
                ? pick(C.EXERCISE_STATUS_LINES[S.state.exercise.kindId] || ["正在运动。"])
                : E.tapLine(S.state, C, Date.now()),
              { duration: 5200 }
            );
          }
          break;
        case "sound":
          S.settings.sound = !S.settings.sound;
          S.sfx.setEnabled(S.settings.sound);
          Shell.setSetting("sound", S.settings.sound);
          toast(S.settings.sound ? "声音打开啦" : "安静下来了", 1600);
          break;
        case "resetPos":
          Shell.resetPosition();
          toast("回到右下角了", 1600);
          break;
        case "hide":
          Shell.hide();
          break;
        case "quit":
          Shell.quit();
          break;
      }
    });
  });
}

function closeMenu() {
  if (!S.menuOpen) return;
  S.menuOpen = false;
  els.ctxMenu.classList.add("hidden");
  if (isElectron) setTimeout(hitTestNow, 0);
}

/* --------------------------------------------------------------- modal */

function confirmDialog({ kicker, title, text, okText, cancelText, onOk }) {
  S.recapOpen = true;
  els.modalLayer.innerHTML = `
    <div class="recap" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="recap-head">
        <div class="r-kicker">${escapeHtml(kicker || "MOMO")}</div>
        <div class="r-place">${escapeHtml(title)}</div>
        <div class="stamp">SURE?</div>
      </div>
      <div class="recap-body">
        <p class="recap-line" style="font-size:14px">${escapeHtml(text)}</p>
        <div class="recap-stamp" style="border-top:none;padding-top:4px">
          <button class="btn small ghost" id="confirmNo">${escapeHtml(cancelText || "再想想")}</button>
          <button class="btn small primary" id="confirmYes">${escapeHtml(okText || "确定")}</button>
        </div>
      </div>
    </div>`;
  els.modalLayer.classList.add("open");
  els.modalLayer.setAttribute("aria-hidden", "false");
  const done = () => {
    S.recapOpen = false;
    els.modalLayer.classList.remove("open");
    els.modalLayer.setAttribute("aria-hidden", "true");
    setTimeout(() => {
      if (!S.recapOpen) els.modalLayer.innerHTML = "";
    }, 240);
  };
  $("#confirmNo", els.modalLayer).addEventListener("click", done);
  $("#confirmYes", els.modalLayer).addEventListener("click", () => {
    done();
    if (onOk) onOk();
  });
  els.modalLayer.onclick = (e) => {
    if (e.target === els.modalLayer) done();
  };
}

/* ---------------------------------------------------------- hit testing */

function buildPetMask() {
  const img = new Image();
  img.onload = () => {
    const size = 96;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, size, size);
    try {
      const data = ctx.getImageData(0, 0, size, size).data;
      const mask = new Uint8Array(size * size);
      for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3];
      S.petMask = { size, mask };
    } catch (_) {
      S.petMask = null;
    }
  };
  img.src = els.petImg.src;
}

function petPixelAt(clientX, clientY) {
  const rect = els.petZone.getBoundingClientRect();
  if (
    clientX < rect.left ||
    clientX > rect.right ||
    clientY < rect.top ||
    clientY > rect.bottom
  ) {
    return false;
  }
  if (!S.petMask) return true;
  const { size, mask } = S.petMask;
  const x = clamp(Math.floor(((clientX - rect.left) / rect.width) * size), 0, size - 1);
  const y = clamp(Math.floor(((clientY - rect.top) / rect.height) * size), 0, size - 1);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const px = clamp(x + dx, 0, size - 1);
      const py = clamp(y + dy, 0, size - 1);
      if (mask[py * size + px] > 20) return true;
    }
  }
  return false;
}

function isInteractiveAt(x, y) {
  if (S.sheetOpen || S.recapOpen || S.menuOpen) return true;
  if (S.dragging) return true;
  const hit = document.elementFromPoint(x, y);
  if (!hit) return false;
  if (hit.closest(".dock, .away-card, .icon-btn, .dock-card, .pair-card")) return true;
  if (hit.closest(".pet-zone")) return petPixelAt(x, y);
  return false;
}

let hitRaf = 0;
let hitPoint = null;
function scheduleHitTest(x, y) {
  hitPoint = { x, y };
  S.lastMouse = { x, y };
  if (hitRaf) return;
  hitRaf = requestAnimationFrame(() => {
    hitRaf = 0;
    if (!hitPoint) return;
    const ignore = !isInteractiveAt(hitPoint.x, hitPoint.y);
    if (ignore !== S.ignore) {
      S.ignore = ignore;
      Shell.setIgnore(ignore);
    }
  });
}

function hitTestNow() {
  if (!isElectron) return;
  const pt = S.lastMouse || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const ignore = !isInteractiveAt(pt.x, pt.y);
  S.ignore = ignore;
  Shell.setIgnore(ignore);
}

/* --------------------------------------------------------------- misc */

function firstTip() {
  if (!S.state || !S.booted) return;
  if (localStorage.getItem("momo.tipSeen")) return;
  localStorage.setItem("momo.tipSeen", "1");
  if (S.state.totals.taps === 0 && S.state.totals.feeds === 0 && !els.bubble.classList.contains("show")) {
    const tip = isElectron
      ? "右键我，可以打开个人页面。……先记住这句。"
      : "长按我，可以打开手账。……先记住这句。";
    S.bubble.show(tip, { duration: 6500 });
  }
}

/* start */
init().catch((err) => {
  console.error(err);
  finishBoot();
  toast("小屋打开时遇到了一点问题", 3000);
});


if ("serviceWorker" in navigator && (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
