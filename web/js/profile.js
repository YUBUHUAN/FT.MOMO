/* Profile / account / health / settings page. */
import { Api } from "./api.js";
import { Shell } from "./shell.js";
import { $, escapeHtml, fmtClock, fmtDuration, relative } from "./util.js";

const C = window.MomoContent;
const E = window.MomoEngine;

const S = {
  api: null,
  state: null,
  settings: { sound: true, alwaysOnTop: true, autoLaunch: false },
  connected: false,
  bootstrap: null,
  offline: false,
  weekOffset: 0,
  friend: null,
  friendActivity: null
};

const els = {
  body: document.body,
  name: $("#pName"),
  days: $("#pDays"),
  moodLabel: $("#pMoodLabel"),
  moodNote: $("#pMoodNote"),
  accountInline: $("#pAccount"),
  dial: $("#moodDial"),
  dialEmoji: $("#dialEmoji"),
  dialValue: $("#dialValue"),
  fullValue: $("#pFullValue"),
  fullBar: $("#pFullBar"),
  fullNote: $("#pFullNote"),
  healthValue: $("#pHealthValue"),
  healthBar: $("#pHealthBar"),
  healthNote: $("#pHealthNote"),
  fatigueValue: $("#pFatigueValue"),
  fatigueBar: $("#pFatigueBar"),
  fatigueNote: $("#pFatigueNote"),
  todayTime: $("#pTodayTime"),
  taps: $("#pTaps"),
  feeds: $("#pFeeds"),
  outingCount: $("#pOutingCount"),
  exerciseCount: $("#pExerciseCount"),
  chart: $("#pChart"),
  chartTitle: $("#chartTitle"),
  chartRange: $("#chartRange"),
  chartPrev: $("#chartPrev"),
  chartNext: $("#chartNext"),
  chartCal: $("#chartCal"),
  chartNote: $("#pChartNote"),
  feedLog: $("#pFeedLog"),
  trips: $("#pTripList"),
  exercises: $("#pExerciseList"),
  sleepLog: $("#pSleepList"),
  pTag: $("#pTag"),
  pVersion: $("#pVersion"),
  pStorage: $("#pStorage"),
  accountName: $("#pAccountName"),
  serverLink: $("#pServerLink"),
  pairNote: $("#pPairNote"),
  addresses: $("#pAddresses"),
  live: $("#pLive"),
  modal: $("#pModal"),
  modalCard: $("#pModalCard"),
  friendCode: $("#pFriendCode"),
  friendHint: $("#pFriendHint"),
  friendForm: $("#pFriendForm"),
  friendInput: $("#pFriendInput"),
  friendSend: $("#pFriendSend"),
  friendLinked: $("#pFriendLinked"),
  friendCopy: $("#pFriendCopy")
};

let toastTimer = null;
function toast(text, ms = 2200) {
  const node = document.getElementById("toast");
  node.textContent = text;
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), ms);
}

async function init() {
  if (Shell.isElectron) els.body.classList.add("is-electron");
  bindStatic();
  S.settings = await Shell.getSettings();
  renderSettings();

  try {
    const api = await Api.boot();
    S.api = api;
    S.bootstrap = api.bootstrap;
    if (api.offline) {
      const cached = api.cached || Api.cachedState();
      if (cached) render(cached);
      setLive(false);
    } else {
      const state = await api.state();
      render(state);
      setLive(true);
      api.connect({ onState: onLive, onStatus: setLive });
      setInterval(() => heartbeat(), 20000);
    }
    renderSync();
    refreshFriend();
    if (location.hash === "#friend") setTimeout(() => document.getElementById("friendCard")?.scrollIntoView({ behavior: "smooth", block: "start" }), 350);
    setInterval(() => { if (!document.hidden) refreshFriend(); }, 3000);
  } catch (err) {
    if (err && err.needsAuth) {
      location.replace("/");
      return;
    }
    const cached = Api.cachedState();
    if (cached) render(cached);
    setLive(false);
    renderSync();
  }
}

function bindStatic() {
  $("#pBack").addEventListener("click", goBack);
  $("#pClose").addEventListener("click", () => Shell.closeProfile());
  $("#copyLink").addEventListener("click", async () => {
    const link = (S.api && S.api.urls.length && S.api.urls[0].url) || location.origin + "/";
    await Shell.copy(link);
    toast("地址已复制");
  });
  $("#logoutBtn").addEventListener("click", openLogout);
  if (els.friendSend) els.friendSend.addEventListener("click", sendFriendRequest);
  if (els.friendCopy) els.friendCopy.addEventListener("click", async () => {
    if (!els.friendCode || !els.friendCode.textContent || els.friendCode.textContent === "------") return;
    await Shell.copy(els.friendCode.textContent);
    toast("好友码已复制");
  });
  if (els.friendInput) els.friendInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendFriendRequest();
  });
  $("#chartPrev").addEventListener("click", () => {
    S.weekOffset -= 1;
    renderChart(S.state);
  });
  $("#chartNext").addEventListener("click", () => {
    if (S.weekOffset >= 0) return;
    S.weekOffset += 1;
    renderChart(S.state);
  });
  els.chartCal.addEventListener("click", openCalendar);
  let swipeX = null;
  els.chart.addEventListener("pointerdown", (e) => { swipeX = e.clientX; });
  els.chart.addEventListener("pointerup", (e) => {
    if (swipeX == null) return;
    const dx = e.clientX - swipeX;
    swipeX = null;
    if (Math.abs(dx) < 38) return;
    if (dx > 0) S.weekOffset -= 1;
    else if (S.weekOffset < 0) S.weekOffset += 1;
    renderChart(S.state);
  });
  $("#pRename").addEventListener("click", openRename);
  $("#setSound").addEventListener("click", () => toggleSetting("sound"));
  $("#setTop").addEventListener("click", () => toggleSetting("alwaysOnTop"));
  $("#setLaunch").addEventListener("click", () => toggleSetting("autoLaunch"));
  $("#setResetPos").addEventListener("click", () => {
    Shell.resetPosition();
    toast("她回到右下角了");
  });
  $("#setReset").addEventListener("click", openReset);
  els.modal.addEventListener("click", (e) => {
    if (e.target === els.modal) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

function goBack() {
  if (Shell.isElectron) return Shell.closeProfile();
  if (document.referrer && document.referrer.startsWith(location.origin)) history.back();
  else location.href = "/";
}

function onLive(state) {
  render(state);
  setLive(true);
}

function setLive(online) {
  S.connected = !!online;
  if (els.live) els.live.classList.toggle("offline", !online);
  if (S.api) S.api.offline = !online;
}

async function heartbeat() {
  if (!S.api || S.api.offline) return;
  const body = await S.api.heartbeat(document.visibilityState === "visible");
  if (body && body.state && (!S.state || body.state.rev >= S.state.rev)) {
    render(body.state);
  }
}

/* ------------------------------------------------------------------ render */

function render(state) {
  if (!state) return;
  if (S.state && Number.isFinite(state.rev) && state.rev < S.state.rev) return;
  S.state = state;
  const s = state;
  const mood = E.moodLabel(s.mood, C);
  const days = E.daysTogether(s, Date.now());
  const daily = (s.daily && s.daily[s.today]) || { activeSeconds: 0 };

  document.title = `${s.name || C.DEFAULT_NAME} 的手账`;
  els.name.textContent = s.name || C.DEFAULT_NAME;
  els.days.textContent = `第 ${days} 天`;
  els.moodLabel.textContent = `心情 · ${mood.label}`;
  els.moodNote.textContent = mood.note;
  els.accountInline.textContent = `@${(S.api && S.api.accountName) || "guest"}`;
  document.body.dataset.scene = s.background || "home";
  els.dial.style.setProperty("--p", `${Math.round(s.mood)}%`);
  els.dialEmoji.textContent = mood.emoji;
  els.dialValue.textContent = Math.round(s.mood);
  els.pTag.textContent = `DAY ${String(days).padStart(2, "0")}`;
  if (els.pVersion) els.pVersion.textContent = `墨墨 v${C.VERSION || "1.7.0.3"}`;
  if (els.pStorage) els.pStorage.textContent = "云端同步 · 数据保存在 Supabase";

  const fullness = Number(s.fullness) || 0;
  els.fullValue.textContent = Math.round(fullness);
  els.fullBar.style.width = `${Math.round(fullness)}%`;
  els.fullNote.textContent =
    fullness >= 90
      ? "真的吃不下了，再喂也只能看着。"
      : fullness >= 70
      ? "有点饱，但还可以再吃一小口。"
      : fullness >= 40
      ? "肚子刚刚好，心情也刚刚好。"
      : fullness >= 25
      ? "肚子空空的，正好可以吃点东西。"
      : fullness >= 10
      ? "她已经饿了，喂点东西吧。"
      : "真的很饿了，再拖下去健康会变差。";

  const health = Number(s.health != null ? s.health : 70);
  const fatigue = Number(s.fatigue != null ? s.fatigue : 8);
  els.healthValue.textContent = Math.round(health);
  els.healthBar.style.width = `${Math.round(health)}%`;
  els.healthNote.textContent =
    health >= 85 ? "现在的她很有精神，跑起来像一阵风。"
      : health >= 60 ? "健康值还不错，继续保持。"
      : health >= 35 ? "有一点虚弱，吃点东西、慢慢运动会好起来。"
      : "要好好照顾她。先吃点东西，再慢慢恢复吧。";
  els.fatigueValue.textContent = Math.round(fatigue);
  els.fatigueBar.style.width = `${Math.round(fatigue)}%`;
  els.fatigueNote.textContent =
    fatigue >= 80 ? "真的很累了。让她休息，不要再运动了。"
      : fatigue >= 55 ? "有点疲惫，休息一会儿会恢复得更好。"
      : fatigue >= 25 ? "微微喘，状态还算轻松。"
      : "精神很好，可以一起动一动。";

  els.todayTime.textContent = fmtDuration(daily.activeSeconds || 0);
  els.taps.textContent = s.totals.taps || 0;
  els.feeds.textContent = s.totals.feeds || 0;
  els.outingCount.textContent = s.totals.outings || 0;
  els.exerciseCount.textContent = s.totals.exercises || 0;
  renderSettings();

  renderChart(s);
  renderFeed(s);
  renderTrips(s);
  renderExercises(s);
  renderSleep(s);
  renderSync();
}

function friendStatusText(status) {
  return ({ sleeping: "睡觉中", outing: "出游中", exercise: "运动中" })[status] || "在房间里";
}

function friendAvatar(app) {
  return app === "momo" ? "/assets/friend-momo.png" : "/assets/friend-wowo.png";
}

async function refreshFriend() {
  if (!S.api || S.api.offline) return;
  try {
    const [code, status, events] = await Promise.all([
      S.api.friendCode(), S.api.friendStatus(), S.api.friendEvents().catch(() => null)
    ]);
    if (!code || code.ok === false) return;
    S.friend = status || null;
    S.friendActivity = events && events.activity ? events.activity : null;
    S.friendEvents = events && events.events ? events.events : [];
    if (els.friendCode) els.friendCode.textContent = code.code || "------";
    renderFriend();
  } catch (_) {
    if (els.friendHint && !S.friend) els.friendHint.textContent = "好友服务暂时连不上，稍后再试。";
  }
}

function renderFriend() {
  const f = S.friend;
  if (!els.friendHint) return;
  const pending = Number(f && f.pending || 0);
  const linked = f && f.linked;
  if (linked) {
    if (els.friendForm) els.friendForm.hidden = true;
    if (els.friendLinked) {
      els.friendLinked.hidden = false;
      els.friendLinked.innerHTML = `
        <img src="${friendAvatar(linked.app)}" alt="${escapeHtml(linked.name || "密友")}">
        <div>
          <div class="friend-name">${escapeHtml(linked.name || "密友")}</div>
          <div class="friend-sub">${escapeHtml(friendStatusText(linked.status))} · 心情 ${Math.round(Number(linked.mood) || 0)}</div>
        </div>
        <button class="friend-unbind" type="button">解除</button>
        <div class="friend-actions">
          <button data-friend-action="feed" type="button">喂一口</button>
          <button data-friend-action="outing" type="button">双人出游</button>
          <button data-friend-action="exercise" type="button">双人运动</button>
        </div>`;
      const unbind = els.friendLinked.querySelector(".friend-unbind");
      if (unbind) unbind.addEventListener("click", unbindFriend);
      els.friendLinked.querySelectorAll("[data-friend-action]").forEach((btn) => {
        btn.addEventListener("click", () => openFriendAction(btn.dataset.friendAction));
      });
    }
    if (S.friendActivity && S.friendActivity.status === "pending") {
      const a = S.friendActivity;
      const mine = a.from === "me";
      const box = document.createElement("div");
      box.className = "friend-pending-box";
      box.innerHTML = `<span>${mine ? "已发出" : "收到"}${a.kind === "exercise" ? "双人运动" : "双人出游"}邀请（${escapeHtml(a.option || "")}）${mine ? "，等待回复" : ""}</span>`;
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = mine ? "取消申请" : "拒绝";
      cancel.addEventListener("click", async () => {
        try {
          if (mine) await S.api.friendActivityCancel(a.id);
          else await S.api.friendActivityRespond(a.id, false);
          toast(mine ? "已取消" : "已拒绝");
          await refreshFriend();
        } catch (_) { toast("操作失败"); }
      });
      box.appendChild(cancel);
      if (!mine) {
        const ok = document.createElement("button");
        ok.type = "button"; ok.className = "primary"; ok.textContent = "同意";
        ok.addEventListener("click", async () => {
          try { await S.api.friendActivityRespond(a.id, true); toast("好，一起出发。"); await refreshFriend(); }
          catch (err) { toast(err.message === "busy" ? "现在没空" : "接受失败"); }
        });
        box.appendChild(ok);
      }
      els.friendLinked.appendChild(box);
    }
    els.friendHint.textContent = "已经绑定。双方都发送过申请后，好友关系才成立。";
    return;
  }
  if (els.friendForm) els.friendForm.hidden = false;
  if (els.friendLinked) { els.friendLinked.hidden = true; els.friendLinked.innerHTML = ""; }
  els.friendHint.textContent = pending > 0
    ? `有 ${pending} 位用户向你发来申请。请向对方索取好友码，在下面回发申请，双方才会绑定。`
    : "把好友码发给对方；你也要输入对方的好友码并发送申请，双方都发过才会绑定。";
}

function openFriendAction(kind) {
  const config = kind === "feed"
    ? { title: "喂一口", hint: "悄悄塞给对方，对方上线会看到。", options: [
        ["cookie", "🍪 小饼干"], ["milk", "🥛 热牛奶"], ["cake", "🍰 草莓蛋糕"], ["oden", "🍢 关东煮"]] }
    : kind === "outing"
    ? { title: "双人出游", hint: "发起后等对方同意，固定 30 分钟。", options: [
        ["公园", "🌳 公园"], ["海边", "🌊 海边"], ["游乐场", "🎡 游乐场"]] }
    : { title: "双人运动", hint: "发起后等对方同意，固定 30 分钟。", options: [
        ["羽毛球", "🏸 羽毛球"], ["跳绳", "🪢 跳绳"], ["散步", "🚶 散步"]] };
  const linkedApp = S.friend && S.friend.linked ? S.friend.linked.app : "wowo";
  const art = kind === "feed"
    ? `<img src="${friendAvatar(linkedApp)}" alt=""><span class="friend-art-disc"></span><span class="friend-art-label">偷偷喂一口</span>`
    : kind === "outing"
    ? `<img src="${friendAvatar(linkedApp)}" alt=""><img class="friend-art-second" src="/assets/avatar-round.png" alt=""><span class="friend-art-label">一起出门</span>`
    : `<img src="${friendAvatar(linkedApp)}" alt=""><span class="friend-art-shuttle"></span><span class="friend-art-label">一起动一动</span>`;
  openModal(
    `<div class="friend-action-visual ${kind}">${art}</div>
     <h3>${config.title}</h3>
     <p>${config.hint}</p>
     <div class="friend-choice">
       ${config.options.map(([value, label]) => `<button type="button" data-value="${escapeHtml(value)}">${label}</button>`).join("")}
     </div>
     <div class="pmodal-actions"><button class="btn small ghost" id="friendActionCancel">取消</button></div>`,
    (root) => {
      $("#friendActionCancel", root).addEventListener("click", closeModal);
      root.querySelectorAll("[data-value]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          try {
            if (kind === "feed") await S.api.friendFeed(btn.dataset.value);
            else await S.api.friendActivityRequest(kind, btn.dataset.value);
            closeModal();
            toast(kind === "feed" ? "已经悄悄塞过去了" : "申请已发出，等对方回复");
            await refreshFriend();
          } catch (err) {
            const msg = err.message === "cooldown" ? "刚喂过，过一会儿再来"
              : err.message === "busy" ? "对方现在没空，或者在忙别的"
              : err.message === "active_exists" ? "已经有一条双人活动了"
              : err.message === "pending_exists" ? "已经有一条申请在等回复"
              : "操作失败，稍后再试";
            toast(msg);
            btn.disabled = false;
          }
        });
      });
    }
  );
}

async function sendFriendRequest() {
  if (!S.api || !els.friendInput) return;
  const code = String(els.friendInput.value || "").trim().toUpperCase();
  if (!code) { toast("先输入对方好友码"); return; }
  if (els.friendSend) els.friendSend.disabled = true;
  try {
    const out = await S.api.friendRequest(code);
    if (out && out.status === "matched") {
      toast("绑定成功");
      els.friendInput.value = "";
    } else {
      toast("申请已发出，等对方也回发好友码");
    }
    await refreshFriend();
  } catch (err) {
    const reason = err && err.message;
    const map = {
      bad_code: "好友码不存在或格式不对",
      same_app: "这是同一边的账号，要找对方 App 的用户",
      already_linked: "你已经有密友了，先解除旧绑定",
      target_linked: "对方已经有密友了",
      self: "不能绑定自己"
    };
    toast(map[reason] || "发送失败，稍后再试");
  } finally {
    if (els.friendSend) els.friendSend.disabled = false;
  }
}

async function unbindFriend() {
  if (!S.api) return;
  if (!confirm("确定解除密友绑定吗？")) return;
  try {
    await S.api.friendUnbind();
    S.friend = null;
    toast("已解除绑定");
    await refreshFriend();
  } catch (_) {
    toast("解除失败，稍后再试");
  }
}

function localKey(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function startOfWeek(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const shift = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - shift);
  return x;
}

function renderChart(s) {
  if (!s) return;
  const today = new Date();
  const monday = startOfWeek(today);
  monday.setDate(monday.getDate() + S.weekOffset * 7);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    const key = localKey(d);
    const row = s.daily[key] || { activeSeconds: 0, mood: null };
    days.push({ d, key, seconds: row.activeSeconds || 0, mood: row.mood });
  }
  const max = Math.max(600, ...days.map((d) => d.seconds));
  const labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const todayKey = localKey(today);
  els.chart.innerHTML = days
    .map((row, i) => {
      const h = Math.max(4, Math.round((row.seconds / max) * 92));
      const mins = Math.round(row.seconds / 60);
      const future = row.d > today && row.key !== todayKey;
      return `<div class="bar-col ${row.key === todayKey ? "today" : ""} ${future ? "future" : ""}" title="${row.key} · ${mins} 分钟">
        <div class="bar-track"><div class="bar" style="height:${h}px" data-value="${mins} 分钟"></div></div>
        <span class="bar-label">${labels[i]}</span>
      </div>`;
    })
    .join("");
  const range = `${days[0].d.getMonth() + 1}/${days[0].d.getDate()} - ${days[6].d.getMonth() + 1}/${days[6].d.getDate()}`;
  els.chartRange.textContent = `${range} · 周一 - 周日`;
  els.chartTitle.textContent = S.weekOffset === 0 ? "本周" : S.weekOffset === -1 ? "上周" : `前 ${-S.weekOffset} 周`;
  els.chartNext.disabled = S.weekOffset >= 0;
  const total = Math.round(days.reduce((a, d) => a + d.seconds, 0) / 60);
  const futureCount = days.filter((d) => d.d > today && d.key !== todayKey).length;
  els.chartNote.textContent = total > 0
    ? `这一周陪了 ${total} 分钟${futureCount ? "（后面的日子还没到）" : ""}。`
    : futureCount === 7 ? "这一周还没开始。" : "这一周还没有记录。";
}

function openCalendar() {
  if (!S.state) return;
  let month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let selected = "";

  const show = () => {
    const y = month.getFullYear();
    const m = month.getMonth();
    const first = new Date(y, m, 1);
    const blanks = (first.getDay() + 6) % 7;
    const count = new Date(y, m + 1, 0).getDate();
    const todayKey = localKey(new Date());
    let cells = "";
    for (let i = 0; i < blanks; i++) cells += '<button class="cal-day blank" tabindex="-1"></button>';
    for (let day = 1; day <= count; day++) {
      const key = localKey(new Date(y, m, day));
      const row = S.state.daily[key];
      const has = row && row.activeSeconds > 0;
      const cls = ["cal-day", has ? "has" : "", key === todayKey ? "today" : "", key === selected ? "selected" : ""].join(" ");
      cells += `<button class="${cls}" data-date="${key}">${day}</button>`;
    }
    openModal(
      `<div class="modal-cal">
        <div class="cal-head">
          <button class="week-nav" id="calPrev" aria-label="上个月">‹</button>
          <h3>${y} 年 ${m + 1} 月</h3>
          <button class="week-nav" id="calNext" aria-label="下个月">›</button>
        </div>
        <div class="cal-weekdays"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>
        <div class="cal-grid">${cells}</div>
        <div class="cal-detail" id="calDetail">点一天，看看那天她陪了你多久。</div>
      </div>`,
      (root) => {
        $("#calPrev", root).addEventListener("click", () => { month = new Date(y, m - 1, 1); show(); });
        $("#calNext", root).addEventListener("click", () => { month = new Date(y, m + 1, 1); show(); });
        root.querySelectorAll(".cal-day[data-date]").forEach((btn) => {
          btn.addEventListener("click", () => {
            selected = btn.dataset.date;
            root.querySelectorAll(".cal-day").forEach((n) => n.classList.toggle("selected", n.dataset.date === selected));
            const row = S.state.daily[selected] || { activeSeconds: 0, mood: null };
            const [yy, mm, dd] = selected.split("-").map(Number);
            const label = `${mm} 月 ${dd} 日`;
            const mins = Math.round((row.activeSeconds || 0) / 60);
            const mood = row.mood != null ? ` · 心情 ${Math.round(row.mood)}` : "";
            $("#calDetail", root).innerHTML = mins > 0
              ? `<b>${label}</b> · 陪了 ${mins} 分钟${mood}`
              : `<b>${label}</b> · 这天还没有记录。`;
          });
        });
      }
    );
  };
  show();
}

function renderFeed(s) {
  const items = (s.feedLog || []).slice(0, 4);
  if (!items.length) {
    els.feedLog.innerHTML = '<li class="empty">还没有喂过东西。<br>奶茶、炸串、火锅……她都在等。</li>';
    return;
  }
  els.feedLog.innerHTML = items
    .map((f) => {
      const extra = Number(f.healthDelta) ? ` · 健康 +${Number(f.healthDelta)}` : "";
      return `<li class="feed-item">
        <span class="fi-emoji">${escapeHtml(f.emoji || "🍰")}</span>
        <div class="fi-main">
          <div class="fi-top">
            <span class="fi-name">${escapeHtml(f.itemName || "小零食")}<span>${escapeHtml(f.optionLabel || "")}${extra}</span></span>
            <span class="fi-time">${escapeHtml(relative(f.at))}</span>
          </div>
          <p class="fi-line">“${escapeHtml(f.line || "")}”</p>
        </div>
      </li>`;
    })
    .join("");
}

function renderTrips(s) {
  const rows = [];
  if (s.outing) {
    const left = Math.max(0, s.outing.endsAt - Date.now());
    rows.push(`<div class="trip">
      <span class="t-emoji">${escapeHtml(s.outing.emoji || "🎒")}</span>
      <div class="t-main">
        <div class="t-name">正在${escapeHtml(s.outing.name)}</div>
        <div class="t-sub" data-trip-live>还有 ${fmtClock(left)} 回来</div>
      </div>
      <span class="t-delta">+${s.outing.moodPreview || 0}</span>
    </div>`);
  }
  (s.outingHistory || []).slice(0, 4).forEach((t) => {
    rows.push(`<div class="trip">
      <span class="t-emoji">${escapeHtml(t.emoji || "🌿")}</span>
      <div class="t-main">
        <div class="t-name">${escapeHtml(t.name)}</div>
        <div class="t-sub">${escapeHtml(relative(t.at))} · ${t.actualMinutes || t.minutes} 分钟${t.cancelled ? " · 刚出门就回来" : t.early ? " · 提前回来" : ""}</div>
        ${t.surprise ? `<div class="t-surprise">小惊喜：${escapeHtml(t.surprise)}</div>` : ""}
      </div>
      <span class="t-delta">+${Number(t.moodDelta) || 0}</span>
    </div>`);
  });
  els.trips.innerHTML = rows.length
    ? rows.join("")
    : '<div class="empty">还没有出过门。<br>去公园坐坐，或者去游乐场看一次摩天轮。</div>';
  updateTripClock();
}

function renderSleep(s) {
  if (!els.sleepLog) return;
  const rows = [];
  if (s.sleeping && s.sleepSince) {
    const mins = Math.max(1, Math.round((Date.now() - Date.parse(s.sleepSince)) / 60000));
    rows.push(`<div class="trip">
      <span class="t-emoji">🌙</span>
      <div class="t-main">
        <div class="t-name">正在睡觉</div>
        <div class="t-sub">已经睡了 ${mins} 分钟 · 点台灯可以叫醒她</div>
      </div>
      <span class="t-delta">💤</span>
    </div>`);
  }
  (s.sleepLog || []).slice(0, 4).forEach((t) => {
    rows.push(`<div class="trip">
      <span class="t-emoji">🌙</span>
      <div class="t-main">
        <div class="t-name">睡了 ${Math.max(1, Number(t.minutes) || 1)} 分钟</div>
        <div class="t-sub">${escapeHtml(relative(t.wokeAt || t.at))} · 睡醒</div>
      </div>
      <span class="t-delta">💤</span>
    </div>`);
  });
  els.sleepLog.innerHTML = rows.length
    ? rows.join("")
    : '<div class="empty">还没有睡眠记录。<br>点主页面上的台灯，哄她睡一觉。</div>';
}

function renderExercises(s) {
  const rows = [];
  if (s.exercise) {
    const left = Math.max(0, s.exercise.endsAt - Date.now());
    rows.push(`<div class="trip">
      <span class="t-emoji">${escapeHtml(s.exercise.emoji || "🏃")}</span>
      <div class="t-main">
        <div class="t-name">正在${escapeHtml(s.exercise.name)}</div>
        <div class="t-sub" data-exercise-live>还有 ${fmtClock(left)} 结束 · 挥汗如雨</div>
      </div>
      <span class="t-delta">+${s.exercise.healthPreview || 0}</span>
    </div>`);
  }
  (s.exerciseHistory || []).slice(0, 4).forEach((t) => {
    rows.push(`<div class="trip">
      <span class="t-emoji">${escapeHtml(t.emoji || "🏃")}</span>
      <div class="t-main">
        <div class="t-name">${escapeHtml(t.name)}</div>
        <div class="t-sub">${escapeHtml(relative(t.at))} · ${t.actualMinutes || t.minutes} 分钟${t.early ? " · 提前停下" : ""} · 健康 +${Number(t.healthDelta) || 0} / 疲惫 +${Number(t.fatigueDelta) || 0}</div>
      </div>
      <span class="t-delta">+${Number(t.healthDelta) || 0}</span>
    </div>`);
  });
  els.exercises.innerHTML = rows.length
    ? rows.join("")
    : '<div class="empty">还没有运动记录。<br>跑步、跳绳、散步，或者只是拉伸五分钟。</div>';
  updateExerciseClock();
}

function updateTripClock() {
  if (!S.state || !S.state.outing) return;
  const node = document.querySelector("[data-trip-live]");
  if (!node) return;
  node.textContent = `还有 ${fmtClock(Math.max(0, S.state.outing.endsAt - Date.now()))} 回来`;
}

function updateExerciseClock() {
  if (!S.state || !S.state.exercise) return;
  const node = document.querySelector("[data-exercise-live]");
  if (!node) return;
  node.textContent = `还有 ${fmtClock(Math.max(0, S.state.exercise.endsAt - Date.now()))} 结束 · 挥汗如雨`;
}

setInterval(() => {
  updateTripClock();
  updateExerciseClock();
}, 1000);

/* ------------------------------------------------------------------ sync */

function renderSync() {
  if (!S.api) return;
  const api = S.api;
  const boot = S.bootstrap || api.bootstrap || {};
  els.accountName.textContent = api.accountName || "已登录";
  const urls = (boot && boot.urls) || [];
  const link = (urls[0] && urls[0].url) || location.origin;
  els.serverLink.textContent = boot.cloud ? "Supabase 云同步" : link.replace(/^https?:\/\//, "");

  if (boot.cloud) {
    els.addresses.innerHTML = '<div class="addr"><span>同步方式</span><b>云端账号 · 电脑/手机互通</b></div>';
    els.pairNote.textContent = "电脑和手机登录同一个账号即可同步，不再需要同一个 Wi-Fi，也不用填电脑地址。";
    const copy = document.getElementById("copyLink");
    if (copy) copy.style.display = "none";
  } else if (urls.length) {
    els.addresses.innerHTML = urls
      .map(
        (u) => `<div class="addr"><span>${escapeHtml(u.name || "局域网")}</span><b>${escapeHtml(u.url.replace(/^https?:\/\//, ""))}</b></div>`
      )
      .join("");
    els.pairNote.textContent = "手机和电脑连同一个 Wi-Fi，打开上面的地址，登录同一个账号和密码。所有账号数据互相独立。";
  } else {
    els.addresses.innerHTML = "";
    els.pairNote.textContent = "这台设备已经登录。手机打开电脑上的地址，登录同一个账号即可同步；电脑需要保持开机。";
  }

  const status = document.createElement("div");
  status.className = "pair-status";
  const statusText = S.connected ? (boot.cloud ? "云端已连接" : "正在和另一端同步") : "离线 · 稍后会自动重连";
  status.innerHTML = `<span class="dot ${S.connected ? "" : "offline"}"></span><span>${statusText}</span>`;
  const old = els.addresses.parentElement.querySelector(".pair-status");
  if (old) old.replaceWith(status);
  else els.addresses.parentElement.appendChild(status);
}

/* --------------------------------------------------------------- settings */

function renderSettings() {
  const set = (id, on, disabled = false) => {
    const node = document.getElementById(id);
    if (!node) return;
    node.classList.toggle("on", !!on);
    node.setAttribute("aria-checked", on ? "true" : "false");
    node.disabled = disabled;
  };
  set("setSound", S.settings.sound);
  set("setTop", S.settings.alwaysOnTop);
  set("setLaunch", S.settings.autoLaunch);

}


async function toggleSetting(key) {
  const next = !S.settings[key];
  try {
    S.settings = await Shell.setSetting(key, next);
    renderSettings();
    const label = key === "sound" ? "声音" : key === "alwaysOnTop" ? "始终置顶" : "开机启动";
    toast(`${label}${next ? "已打开" : "已关闭"}`);
  } catch (err) {
    toast("这个设置现在改不了");
  }
}

Shell.onSettings((next) => {
  S.settings = Object.assign({}, S.settings, next || {});
  renderSettings();
});

/* ------------------------------------------------------------------ modal */

function openModal(html, onMount) {
  els.modalCard.innerHTML = html;
  els.modal.classList.add("open");
  els.modal.setAttribute("aria-hidden", "false");
  if (onMount) onMount(els.modalCard);
}

function closeModal() {
  els.modal.classList.remove("open");
  els.modal.setAttribute("aria-hidden", "true");
}

function openRename() {
  if (!S.state) return;
  openModal(
    `<h3>叫她什么？</h3>
     <p>名字会出现在桌面、手账和两台设备上。账号名不会变。</p>
     <input class="pinput" id="nameInput" maxlength="12" value="${escapeHtml(S.state.name || C.DEFAULT_NAME)}" aria-label="名字">
     <div class="pmodal-actions">
       <button class="btn small ghost" id="nameCancel">取消</button>
       <button class="btn small primary" id="nameOk">改好了</button>
     </div>`,
    (root) => {
      const input = $("#nameInput", root);
      input.focus();
      input.select();
      $("#nameCancel", root).addEventListener("click", closeModal);
      const submit = async () => {
        const name = input.value.trim();
        if (!name) return input.focus();
        try {
          const body = await S.api.action("rename", { name });
          render(body.state);
          closeModal();
          toast("她记住了新名字");
        } catch (_) {
          toast("现在改不了名字");
        }
      };
      $("#nameOk", root).addEventListener("click", submit);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit();
      });
    }
  );
}

function openReset() {
  if (!S.state) return;
  openModal(
    `<h3>要重新开始吗？</h3>
     <p>心情、饱食度、健康、投喂记录、运动记录、出游手账和陪伴时间都会清零。名字、账号会留下。</p>
     <div class="pmodal-actions">
       <button class="btn small ghost" id="resetNo">再想想</button>
       <button class="btn small danger" id="resetYes">清零</button>
     </div>`,
    (root) => {
      $("#resetNo", root).addEventListener("click", closeModal);
      $("#resetYes", root).addEventListener("click", async () => {
        try {
          const body = await S.api.action("reset", { confirm: S.state.createdAt });
          render(body.state);
          closeModal();
          toast("小屋重新亮起来了");
        } catch (_) {
          toast("重置没有成功");
        }
      });
    }
  );
}

function openLogout() {
  openModal(
    `<h3>退出这个账号？</h3>
     <p>退出后这台设备会回到登录页。账号里的小屋和记录都会保留，下次登录还能回来。</p>
     <div class="pmodal-actions">
       <button class="btn small ghost" id="logoutNo">先不退出</button>
       <button class="btn small danger" id="logoutYes">退出账号</button>
     </div>`,
    (root) => {
      $("#logoutNo", root).addEventListener("click", closeModal);
      $("#logoutYes", root).addEventListener("click", async () => {
        await S.api.logout();
        location.href = "/";
      });
    }
  );
}

/* ------------------------------------------------------------------ start */

init().catch((err) => {
  console.error(err);
  toast("手账翻开时遇到了一点问题");
});

if ("serviceWorker" in navigator && (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
