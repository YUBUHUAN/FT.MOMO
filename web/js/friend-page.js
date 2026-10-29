/* Dedicated friend page: compact card layout + ticket countdown. */
import { Api } from "./api.js";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[ch]));
const avatar = (app) => app === "momo" ? "/assets/friend-momo.png" : "/assets/friend-wowo.png";
const statusText = (status) => ({ sleeping: "睡觉中", outing: "出游中", exercise: "运动中" })[status] || "在房间里";
const clock = (ms) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

const S = { api: null, code: "", friend: null, activity: null, events: [], tick: null, busy: false };
const root = $("#friendRoot");
const toastEl = $("#fbToast");
const modal = $("#fbModal");

function toast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toastEl.hidden = true; }, 2200);
}

async function boot() {
  try {
    S.api = await Api.boot();
  } catch (err) {
    if (err && (err.needsAuth || err.offline)) {
      location.replace("/");
      return false;
    }
    root.innerHTML = `<div class="fb-card fb-empty">好友服务暂时连不上。<br>稍后再试。</div>`;
    return false;
  }
  return true;
}

async function load() {
  if (!S.api || S.busy) return;
  S.busy = true;
  try {
    const [code, status, events] = await Promise.all([
      S.api.friendCode(),
      S.api.friendStatus(),
      S.api.friendEvents().catch(() => null)
    ]);
    if (code && code.ok !== false) S.code = code.code || "";
    S.friend = status || null;
    S.activity = events && events.activity ? events.activity : null;
    S.events = events && events.events ? events.events : [];
    render();
    handleEvents();
  } catch (_) {
    root.innerHTML = `<div class="fb-card fb-empty">好友服务暂时不可用。<br>请稍后再试。</div>`;
  } finally {
    S.busy = false;
  }
}

function friendCard() {
  const f = S.friend;
  const linked = f && f.linked;
  if (!linked) {
    return `<div class="fb-card">
      <div class="fb-empty" style="padding:4px 0 14px;text-align:left">还没有绑定密友。<br>把好友码发给对方，再输入对方的好友码。</div>
      <div class="fb-code-row" style="margin-top:0;padding-top:0;border:0">
        <div><small>我的好友码</small><b>${esc(S.code || "------")}</b></div>
        <button class="fb-copy" data-copy>复制</button>
      </div>
      <div class="fb-code-form"><input id="fbCodeInput" maxlength="12" placeholder="输入对方好友码"><button data-request>发送申请</button></div>
    </div>`;
  }
  return `<div class="fb-card">
    <div class="fb-friend-head">
      <img src="${avatar(linked.app)}" alt="${esc(linked.name || "密友")}">
      <div><div class="fb-name">${esc(linked.name || "密友")}</div>
      <div class="fb-meta"><span class="fb-live"></span>${statusText(linked.status)} · 心情 ${Math.round(Number(linked.mood) || 0)}</div></div>
    </div>
    <div class="fb-code-row">
      <div><small>我的好友码</small><b>${esc(S.code || "------")}</b></div>
      <button class="fb-copy" data-copy>复制</button>
    </div>
  </div>`;
}

function ticket() {
  const a = S.activity;
  if (!a || a.status !== "active") return "";
  const linked = S.friend && S.friend.linked;
  const partner = linked ? linked.name : "密友";
  const kind = a.kind === "exercise" ? "exercise" : "outing";
  const label = kind === "exercise" ? "双人运动" : "双人出游";
  const art = kind === "exercise"
    ? `<span class="court"></span><span class="bird"></span>`
    : `<span class="hill"></span><span class="trunk"></span><span class="crown"></span>`;
  return `<div class="fb-section"><h2>正在进行</h2><span>TOGETHER NOW</span></div>
    <div class="fb-ticket">
      <div class="fb-ticket-left">
        <div class="fb-kicker">${kind === "exercise" ? "DOUBLE WORKOUT" : "DOUBLE OUTING"}</div>
        <h3>${label} · ${esc(a.option || "")}</h3>
        <p>和 ${esc(partner)} 一起，回来时会带一张合照。</p>
        <div class="fb-ticket-art ${kind}">${art}</div>
        <div class="fb-ticket-foot"><button data-peek>看看她</button><button data-end>提前结束</button></div>
      </div>
      <div class="fb-ticket-stub"><small>REMAIN</small><b data-countdown data-ends="${esc(a.endsAt || "")}">--:--</b></div>
    </div>`;
}

function actions() {
  const active = S.activity && S.activity.status === "active";
  return `<div class="fb-section"><h2>互动</h2><span>WITH FRIEND</span></div>
    <div class="fb-actions">
      <button class="fb-action feed" data-action="feed" ${active ? "disabled" : ""}>
        <div class="art"><img src="/assets/avatar-round.png" alt=""><span class="plate"></span><span class="cake"></span></div>
        <div class="label">喂一口</div><div class="hint">偷偷塞过去</div>
      </button>
      <button class="fb-action out" data-action="outing" ${active ? "disabled" : ""}>
        <div class="art"><span class="sun"></span><span class="hill a"></span><span class="hill b"></span><img class="a" src="/assets/friend-wowo.png" alt=""><img class="b" src="/assets/friend-momo.png" alt=""></div>
        <div class="label">双人出游</div><div class="hint">30 分钟</div>
      </button>
      <button class="fb-action sport" data-action="exercise" ${active ? "disabled" : ""}>
        <div class="art"><span class="court"></span><span class="bird"></span><img class="a" src="/assets/friend-wowo.png" alt=""><img class="b" src="/assets/friend-momo.png" alt=""></div>
        <div class="label">双人运动</div><div class="hint">羽毛球</div>
      </button>
    </div>`;
}

function pending() {
  const a = S.activity;
  if (!a || a.status !== "pending") return "";
  const invite = S.events.find((e) => e.type === "activity_invite");
  const mine = a.from === "me" || (invite && invite.payload && invite.payload.from === "me");
  const kind = a.kind === "exercise" ? "双人运动" : "双人出游";
  const buttons = mine
    ? `<button class="ghost" data-cancel>取消申请</button>`
    : `<button class="ghost" data-decline>拒绝</button><button data-accept>同意</button>`;
  return `<div class="fb-pending"><span>${mine ? "已发出" : "收到"}${kind}邀请（${esc(a.option || "")}）${mine ? "，等待回复" : ""}</span><div class="fb-pending-actions">${buttons}</div></div>`;
}

function render() {
  if (!S.friend) return;
  const linked = S.friend.linked;
  let html = friendCard();
  if (linked) {
    html += ticket();
    html += actions();
    html += pending();
    html += `<button class="fb-unbind" data-unbind>解除密友绑定</button>`;
  }
  root.innerHTML = html;
  bind();
  tick();
}

function bind() {
  root.querySelectorAll("[data-copy]").forEach((el) => el.addEventListener("click", copyCode));
  const request = root.querySelector("[data-request]");
  if (request) request.addEventListener("click", sendRequest);
  root.querySelectorAll("[data-action]").forEach((el) => el.addEventListener("click", () => openAction(el.dataset.action)));
  root.querySelectorAll("[data-unbind]").forEach((el) => el.addEventListener("click", unbind));
  root.querySelectorAll("[data-peek]").forEach((el) => el.addEventListener("click", peek));
  root.querySelectorAll("[data-end]").forEach((el) => el.addEventListener("click", endActivity));
  root.querySelectorAll("[data-accept]").forEach((el) => el.addEventListener("click", () => respond(true)));
  root.querySelectorAll("[data-decline]").forEach((el) => el.addEventListener("click", () => respond(false)));
  root.querySelectorAll("[data-cancel]").forEach((el) => el.addEventListener("click", cancelActivity));
}

function tick() {
  clearInterval(S.tick);
  const node = root.querySelector("[data-countdown]");
  if (!node) return;
  const ends = Date.parse(node.dataset.ends || "");
  if (!Number.isFinite(ends)) { node.textContent = "--:--"; return; }
  const update = () => {
    const left = ends - Date.now();
    node.textContent = clock(left);
    if (left <= 0) {
      clearInterval(S.tick);
      setTimeout(load, 900);
    }
  };
  update();
  S.tick = setInterval(update, 1000);
}

async function copyCode() {
  try {
    await navigator.clipboard.writeText(S.code);
    toast("好友码已复制");
  } catch (_) { toast(S.code); }
}

async function sendRequest() {
  const input = root.querySelector("#fbCodeInput");
  const code = (input && input.value || "").trim().toUpperCase();
  if (!code) { toast("先输入好友码"); return; }
  try {
    const out = await S.api.friendRequest(code);
    if (out && out.ok === false) {
      toast(out.error === "not_found" ? "好友码不存在" : "发送失败");
      return;
    }
    toast("申请已发出");
    await load();
  } catch (_) { toast("发送失败"); }
}

async function unbind() {
  if (!confirm("解除绑定后，双人活动和喂食记录会保留，但不能再互动。确定吗？")) return;
  try { await S.api.friendUnbind(); toast("已解除绑定"); await load(); }
  catch (_) { toast("解除失败"); }
}

function openAction(kind) {
  if (S.activity && S.activity.status === "active") { toast("正在双人活动中"); return; }
  const config = kind === "feed"
    ? { title: "喂一口", hint: "悄悄塞给对方，对方上线会看到。", choices: [["cookie", "小饼干"], ["milk", "热牛奶"], ["cake", "草莓蛋糕"], ["oden", "关东煮"]] }
    : kind === "outing"
    ? { title: "双人出游", hint: "发出后等对方同意，固定 30 分钟。", choices: [["公园", "公园"], ["海边", "海边"], ["游乐场", "游乐场"]] }
    : { title: "双人运动", hint: "发出后等对方同意，固定 30 分钟。", choices: [["羽毛球", "羽毛球"], ["跳绳", "跳绳"], ["散步", "散步"]] };
  modal.hidden = false;
  modal.innerHTML = `<div class="fb-mask" data-close></div><div class="fb-sheet">
    <h3>${config.title}</h3><p>${config.hint}</p>
    <div class="fb-choices">${config.choices.map(([value, label]) => `<button class="fb-choice" data-choice="${esc(value)}">${label}</button>`).join("")}</div>
    <div class="fb-sheet-actions"><button data-close>取消</button></div>
  </div>`;
  modal.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", closeModal));
  modal.querySelectorAll("[data-choice]").forEach((el) => el.addEventListener("click", async () => {
    el.disabled = true;
    try {
      if (kind === "feed") {
        await S.api.friendFeed(el.dataset.choice);
        toast("已经悄悄送过去了");
      } else {
        await S.api.friendActivityRequest(kind, el.dataset.choice);
        toast("邀请已发出");
      }
      closeModal();
      await load();
    } catch (err) {
      toast(err.message === "busy" ? "对方现在没空" : "操作失败");
    }
  }));
}

function closeModal() { modal.hidden = true; modal.innerHTML = ""; }

async function respond(accept) {
  if (!S.activity) return;
  try {
    await S.api.friendActivityRespond(S.activity.id, accept);
    toast(accept ? "好，一起出发。" : "已拒绝");
    await load();
  } catch (err) {
    toast(err.message === "busy" ? "现在没空" : "操作失败");
  }
}

async function cancelActivity() {
  if (!S.activity) return;
  try { await S.api.friendActivityCancel(S.activity.id); toast("已取消"); await load(); }
  catch (_) { toast("取消失败"); }
}

async function endActivity() {
  if (!S.activity) return;
  try { await S.api.friendActivityCancel(S.activity.id); toast("已结束"); await load(); }
  catch (_) { toast("操作失败"); }
}

function peek() {
  const linked = S.friend && S.friend.linked;
  toast(linked ? `【${linked.name}】在那边等你。` : "她还在路上。");
}

function handleEvents() {
  const invites = S.events.filter((e) => e.type === "activity_invite");
  if (invites.some((e) => e.payload && e.payload.from === "friend") && !S.activity) {
    toast("密友发来一条活动邀请");
  }
}

$("#fbBack")?.addEventListener("click", () => {
  if (history.length > 1) history.back();
  else location.assign("/");
});

if (await boot()) {
  await load();
  setInterval(() => { if (!document.hidden) load(); }, 5000);
}
