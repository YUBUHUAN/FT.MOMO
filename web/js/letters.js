/* Post-office list view. Loads and renders only the postal area so the
 * friend page's five-second refresh cannot overwrite an open postal state. */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[ch]));

const STYLE_LABEL = {
  warm: "温馨",
  cute: "可爱",
  romantic: "浪漫"
};

const PAPER_LABEL = {
  "paper-cream": "暖米信纸",
  "paper-sakura": "樱粉信纸",
  "paper-night": "星夜信纸"
};

const ENVELOPE_LABEL = {
  "envelope-kraft": "牛皮纸信封",
  "envelope-blue": "晴空信封",
  "envelope-rose": "玫瑰信封"
};

const STICKER_LABEL = {
  "sticker-heart": "心动",
  "sticker-star": "小星星",
  "sticker-leaf": "小叶子",
  "sticker-paw": "爪印",
  "sticker-flower": "小花",
  "sticker-bow": "蝴蝶结"
};

const STICKER_SVG = {
  "sticker-heart": '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 20.4S3.5 15.1 3.5 8.7A4.3 4.3 0 0 1 12 6.5a4.3 4.3 0 0 1 8.5 2.2c0 6.4-8.5 11.7-8.5 11.7Z" fill="#d98291"/></svg>',
  "sticker-star": '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m12 2.8 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.3l6.1-.9L12 2.8Z" fill="#d9b75e"/></svg>',
  "sticker-leaf": '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.2 3.8C12.7 3.2 5.5 6.1 4.1 12.9c-.8 4 1.8 6.6 5.4 5.9 5.9-1.1 9.2-7.5 10.7-15Z" fill="#8eaa7c"/><path d="M5.1 18.5c3.2-4.6 6.7-7.6 11.6-10.1" fill="none" stroke="#f6eedb" stroke-width="1.1" stroke-linecap="round"/></svg>',
  "sticker-paw": '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><ellipse cx="12" cy="15.2" rx="4.7" ry="4" fill="#bd8d70"/><circle cx="6.2" cy="10.4" r="2.1" fill="#bd8d70"/><circle cx="10.8" cy="6.4" r="2.1" fill="#bd8d70"/><circle cx="15.8" cy="7.1" r="2.1" fill="#bd8d70"/><circle cx="19.3" cy="11.6" r="2.1" fill="#bd8d70"/></svg>',
  "sticker-flower": '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g fill="#d9a1b1"><circle cx="12" cy="6" r="3.1"/><circle cx="17.7" cy="9.5" r="3.1"/><circle cx="17.7" cy="15.4" r="3.1"/><circle cx="12" cy="18.8" r="3.1"/><circle cx="6.3" cy="15.4" r="3.1"/><circle cx="6.3" cy="9.5" r="3.1"/></g><circle cx="12" cy="12.4" r="2.7" fill="#e7c56e"/></svg>',
  "sticker-bow": '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M11 12 4.7 7.2c-1.3-1 .1-3.1 1.7-2.5l6.1 2.4L18 4.7c1.6-.6 3 1.5 1.7 2.5L13.4 12l6.3 4.8c1.3 1-.1 3.1-1.7 2.5l-6.1-2.4-6.1 2.4c-1.6.6-3-1.5-1.7-2.5L11 12Z" fill="#c77d8b"/><circle cx="12" cy="12" r="2.2" fill="#f1d29b"/></svg>'
};

function envelopeIcon(style, extraClass = "") {
  const known = Object.prototype.hasOwnProperty.call(ENVELOPE_LABEL, style);
  const variant = known ? String(style) : "envelope-unknown";
  return `<span class="fb-letter-envelope ${esc(variant)}${extraClass ? " " + extraClass : ""}" aria-hidden="true"><i class="fb-letter-envelope-flap"></i><i class="fb-letter-envelope-cloud"></i></span>`;
}

function stickerIcon(style, extraClass = "") {
  const svg = STICKER_SVG[style];
  if (!svg) return "";
  return `<span class="fb-letter-sticker ${esc(style)}${extraClass ? " " + extraClass : ""}" aria-hidden="true">${svg}</span>`;
}

function envelopeLabel(style) {
  return ENVELOPE_LABEL[style] || "信封";
}

const STYLE_OPTIONS = [
  ["warm", "温馨"],
  ["cute", "可爱"],
  ["romantic", "浪漫"]
];
const PAPER_OPTIONS = [
  ["paper-cream", "暖米"],
  ["paper-sakura", "樱粉"],
  ["paper-night", "星夜"]
];
const ENVELOPE_OPTIONS = [
  ["envelope-kraft", "牛皮纸"],
  ["envelope-blue", "晴空"],
  ["envelope-rose", "玫瑰"]
];
const STICKER_OPTIONS = [
  ["sticker-heart", "心动"],
  ["sticker-star", "小星星"],
  ["sticker-leaf", "小叶子"],
  ["sticker-paw", "爪印"],
  ["sticker-flower", "小花"],
  ["sticker-bow", "蝴蝶结"]
];

let toastTimer = 0;
function showToast(message) {
  const el = document.getElementById("fbToast");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

function charCount(value) {
  return Array.from(String(value == null ? "" : value).trim()).length;
}

function newClientToken() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const state = {
  api: null,
  root: null,
  linked: true,
  unread: 0,
  letters: [],
  loading: false,
  busy: false,
  loaded: false,
  error: "",
  nextBefore: null,
  nextBeforeId: null,
  detailId: null,
  detail: null,
  detailLoading: false,
  detailError: "",
  detailWarning: "",
  readInFlight: null,
  readDone: new Set(),
  listScroll: 0,
  compose: null,
  composePreview: false,
  composeSending: false,
  composeError: ""
};

function badge() {
  const el = document.getElementById("fbLetterBadge");
  if (!el) return;
  el.textContent = state.unread > 0 ? String(Math.min(state.unread, 99)) : "";
  el.classList.toggle("hidden", state.unread <= 0);
}

function dateText(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function card(letter) {
  const unread = letter.read === false;
  const read = letter.read === true;
  const style = STYLE_LABEL[letter.style] || "信件";
  const from = letter.senderName || "密友";
  const envelope = envelopeLabel(letter.envelopeStyle);
  return `<article class="fb-letter-card${unread ? " unread" : read ? " read" : ""}" data-letter-open="${esc(letter.id)}" role="button" tabindex="0" aria-label="打开${esc(from)}的${esc(style)}信${read ? "，已读" : unread ? "，未读" : ""}">
    <div class="fb-letter-card-top">
      <span class="fb-letter-style ${esc(letter.style || "warm")}">${esc(style)}</span>
      <span class="fb-letter-top-meta">
        ${read ? '<span class="fb-letter-state">已读</span>' : ""}
        <span class="fb-letter-date">${esc(dateText(letter.createdAt))}</span>
      </span>
    </div>
    <div class="fb-letter-from">${unread ? '<i class="fb-letter-dot"></i>' : ""}${esc(from)}</div>
    <p class="fb-letter-excerpt">${esc(letter.excerpt || "")}</p>
    <div class="fb-letter-foot">
      <span class="fb-letter-envelope-line">${envelopeIcon(letter.envelopeStyle, "mini")}<span>${esc(envelope)}</span></span>
      ${stickerIcon(letter.sticker, "mini")}
      ${letter.hearted ? '<span class="fb-letter-mark">♥</span>' : ""}
      ${letter.favorited ? '<span class="fb-letter-mark">☆</span>' : ""}
    </div>
  </article>`;
}

export const LetterUI = {
  init(api) {
    state.api = api || null;
    return this;
  },

  setLinked(linked) {
    state.linked = !!linked;
  },

  async refreshUnread() {
    if (!state.api) return 0;
    try {
      const out = await state.api.letterUnread();
      if (!out || out.ok === false) return state.unread;
      state.unread = Math.max(0, Number(out.count) || 0);
      badge();
      return state.unread;
    } catch (err) {
      if (err && err.needsAuth) throw err;
      return state.unread;
    }
  },

  async enter(root, { api = state.api, linked = state.linked } = {}) {
    state.api = api;
    state.root = root;
    state.linked = !!linked;
    await this.load();
  },

  async load() {
    if (!state.api || !state.root || state.busy) return;
    state.busy = true;
    state.loading = true;
    state.error = "";
    this.render();
    try {
      const out = await state.api.letterList("inbox", 20, null, null);
      if (!out || out.ok === false) throw new Error((out && out.error) || "letter_failed");
      state.letters = Array.isArray(out.letters) ? out.letters : [];
      state.nextBefore = out.nextBefore || null;
      state.nextBeforeId = out.nextBeforeId || null;
      state.loaded = true;
      await this.refreshUnread();
    } catch (err) {
      if (err && err.needsAuth) {
        location.replace("/");
        return;
      }
      state.error = err && err.offline ? "邮局暂时连不上，稍后再试。" : "邮局加载失败，稍后再试。";
    } finally {
      state.busy = false;
      state.loading = false;
      this.render();
    }
  },

  async loadMore() {
    if (!state.api || !state.root || state.busy || !state.nextBefore || !state.nextBeforeId) return;
    state.busy = true;
    state.error = "";
    this.render();
    try {
      const out = await state.api.letterList("inbox", 20, state.nextBefore, state.nextBeforeId);
      if (!out || out.ok === false) throw new Error((out && out.error) || "letter_failed");
      const seen = new Set(state.letters.map((letter) => letter.id));
      const incoming = Array.isArray(out.letters) ? out.letters : [];
      state.letters = state.letters.concat(incoming.filter((letter) => letter && !seen.has(letter.id)));
      state.nextBefore = out.nextBefore || null;
      state.nextBeforeId = out.nextBeforeId || null;
      await this.refreshUnread();
    } catch (err) {
      if (err && err.needsAuth) {
        location.replace("/");
        return;
      }
      state.error = err && err.offline ? "邮局暂时连不上，稍后再试。" : "更早的信加载失败，请重试。";
    } finally {
      state.busy = false;
      this.render();
    }
  },

  async openDetail(id) {
    if (!state.api || !state.root || !id || state.detailId) return;
    const source = state.letters.find((letter) => letter.id === id);
    state.listScroll = window.scrollY || window.pageYOffset || 0;
    state.detailId = id;
    state.detail = null;
    state.detailLoading = true;
    state.detailError = "";
    state.detailWarning = "";
    this.render();
    try {
      const out = await state.api.letterGet(id);
      if (state.detailId !== id) return;
      if (!out || out.ok === false || !out.letter) {
        throw Object.assign(new Error((out && out.error) || "not_found"), {
          status: out && out.status || 0
        });
      }
      state.detail = out.letter;
      state.detailLoading = false;
      this.render();
      const unread = out.letter.read === false
        || (out.letter.read == null && source && source.read === false);
      if (unread) await this.markRead(id);
    } catch (err) {
      if (err && err.needsAuth) {
        location.replace("/");
        return;
      }
      state.detailLoading = false;
      state.detailError = err && err.offline ? "邮局暂时连不上，请稍后再试。"
        : err && (err.code === "not_found" || err.status === 404) ? "这封信不存在，或已经无法访问。"
        : "信件加载失败，请稍后再试。";
      if (state.detailId === id) this.render();
    }
  },

  async markRead(id) {
    if (!state.api || state.readDone.has(id) || state.readInFlight === id) return;
    state.readInFlight = id;
    try {
      const out = await state.api.letterRead(id);
      if (!out || out.ok === false) throw new Error((out && out.error) || "read_failed");
      state.readDone.add(id);
      const item = state.letters.find((letter) => letter.id === id);
      if (item) item.read = true;
      await this.refreshUnread();
    } catch (err) {
      if (err && err.needsAuth) {
        location.replace("/");
        return;
      }
      state.detailWarning = "已读状态同步失败，稍后可重新打开。";
    } finally {
      if (state.readInFlight === id) state.readInFlight = null;
      if (state.detailId === id && state.detail) this.render();
    }
  },

  closeDetail() {
    if (!state.detailId) return;
    state.detailId = null;
    state.detail = null;
    state.detailLoading = false;
    state.detailError = "";
    state.detailWarning = "";
    this.render();
    const y = state.listScroll || 0;
    requestAnimationFrame(() => window.scrollTo(0, y));
  },

  renderDetail() {
    if (!state.root) return;
    const back = `<button type="button" class="fb-letter-back" data-letter-back>← 返回邮局</button>`;
    if (state.detailLoading) {
      state.root.innerHTML = `<section class="fb-letter-view fb-letter-detail">
        ${back}<div class="fb-letter-loading">正在打开信件……</div>
      </section>`;
      this.bind();
      return;
    }
    if (state.detailError) {
      state.root.innerHTML = `<section class="fb-letter-view fb-letter-detail">
        ${back}<div class="fb-letter-error">${esc(state.detailError)}<button type="button" data-letter-detail-retry>重试</button></div>
      </section>`;
      this.bind();
      return;
    }
    const letter = state.detail;
    if (!letter) return;
    const readonly = !state.linked || letter.linkStatus === "unbound";
    const paper = PAPER_LABEL[letter.paperStyle] || "信纸";
    const envelope = envelopeLabel(letter.envelopeStyle);
    const sticker = STICKER_LABEL[letter.sticker] || "";
    const stickerMarkup = stickerIcon(letter.sticker);
    const created = new Date(letter.createdAt);
    const time = Number.isFinite(created.getTime())
      ? created.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : "";
    state.root.innerHTML = `<section class="fb-letter-view fb-letter-detail">
      ${back}
      <div class="fb-letter-detail-head">
        <span class="fb-letter-style ${esc(letter.style || "warm")}">${esc(STYLE_LABEL[letter.style] || "信件")}</span>
        <span class="fb-letter-date">${esc(time)}</span>
      </div>
      ${readonly ? '<div class="fb-letter-banner">这段密友关系已解除，这封信是只读的历史。</div>' : ""}
      <div class="fb-letter-meta">
        <span class="fb-letter-sender">${esc(letter.senderName || "密友")} → ${esc(letter.recipientName || "你")}</span>
        <div class="fb-letter-envelope-row">
          ${envelopeIcon(letter.envelopeStyle)}
          <span class="fb-letter-envelope-name">${esc(envelope)}</span>
        </div>
        <span class="fb-letter-paper-name">${esc(paper)}</span>
        ${sticker ? `<span class="fb-letter-sticker-name">贴纸 · ${esc(sticker)}</span>` : ""}
      </div>
      <div class="fb-letter-paper ${esc(letter.paperStyle || "paper-cream")}">
        ${stickerMarkup ? `<div class="fb-letter-sticker-corner">${stickerMarkup}</div>` : ""}
        <p class="fb-letter-body">${esc(letter.body || "")}</p>
      </div>
      ${state.detailWarning ? `<div class="fb-letter-inline-error">${esc(state.detailWarning)}</div>` : ""}
    </section>`;
    this.bind();
  },

  openCompose() {
    if (!state.linked) {
      showToast("绑定密友后才能写信。");
      return;
    }
    state.listScroll = window.scrollY || window.pageYOffset || 0;
    state.compose = {
      style: "warm",
      body: "",
      paperStyle: "paper-cream",
      envelopeStyle: "envelope-kraft",
      sticker: null,
      clientToken: newClientToken()
    };
    state.composePreview = false;
    state.composeSending = false;
    state.composeError = "";
    this.render();
  },

  closeCompose(force = false) {
    const draft = state.compose;
    if (!draft) return;
    if (!force && state.composeSending) return;
    if (!force && charCount(draft.body) > 0 && !window.confirm("这封信还没有寄出，确定丢弃吗？")) {
      return;
    }
    state.compose = null;
    state.composePreview = false;
    state.composeSending = false;
    state.composeError = "";
    this.render();
    const y = state.listScroll || 0;
    requestAnimationFrame(() => window.scrollTo(0, y));
  },

  composeErrorText(err) {
    const code = err && (err.code || err.message);
    if (code === "rate_limited") return "寄信太快了，30 秒后再试，或明天再来。";
    if (code === "link_inactive") return "密友关系已解除，不能再寄信。";
    if (code === "bad_body") return "正文需要 1–2000 个字符。";
    if (code === "bad_client_token") return "寄信凭证失效，请返回后重试。";
    if (code === "bad_style" || code === "bad_paper" || code === "bad_envelope" || code === "bad_sticker") {
      return "信件样式无效，请重新选择。";
    }
    if (err && err.offline) return "邮局暂时连不上，稍后再试。";
    return "寄信失败，请稍后再试。";
  },

  updateComposeCounter() {
    if (!state.compose || !state.root) return;
    const textarea = $("[data-compose-body]", state.root);
    const counter = $("[data-compose-count]", state.root);
    const send = $("[data-compose-send]", state.root);
    const error = $("[data-compose-error]", state.root);
    if (!textarea) return;
    state.compose.body = textarea.value;
    const count = charCount(textarea.value);
    if (counter) counter.textContent = `${count} / 2000`;
    if (send) send.disabled = state.composeSending || count < 1 || count > 2000;
    state.composeError = count > 2000 ? "正文最多 2000 个字符。" : "";
    if (error) error.textContent = state.composeError;
  },

  async sendCompose() {
    const draft = state.compose;
    if (!draft || state.composeSending) return;
    const body = draft.body.trim();
    const count = charCount(body);
    if (count < 1) {
      draft.error = "写点内容再寄出。";
      state.composeError = draft.error;
      this.renderCompose();
      return;
    }
    if (count > 2000) {
      draft.error = "正文最多 2000 个字符。";
      state.composeError = draft.error;
      this.renderCompose();
      return;
    }
    state.composeSending = true;
    state.composeError = "";
    this.renderCompose();
    try {
      const out = await state.api.letterSend(
        draft.style,
        body,
        draft.paperStyle,
        draft.envelopeStyle,
        draft.sticker || null,
        null,
        draft.clientToken
      );
      if (!out || out.ok === false) {
        throw Object.assign(new Error((out && out.error) || "send_failed"), {
          code: out && out.error,
          status: out && out.status || 0
        });
      }
      state.compose = null;
      state.composePreview = false;
      state.composeSending = false;
      state.composeError = "";
      this.render();
      showToast("已经寄出");
    } catch (err) {
      if (err && err.needsAuth) {
        location.replace("/");
        return;
      }
      state.composeSending = false;
      state.composeError = this.composeErrorText(err);
      this.renderCompose();
    }
  },

  renderCompose() {
    if (!state.compose || !state.root) return;
    if (state.composePreview) {
      this.renderComposePreview();
      return;
    }
    const draft = state.compose;
    const count = charCount(draft.body);
    const selectedStyle = draft.style;
    const selectedPaper = draft.paperStyle;
    const selectedEnvelope = draft.envelopeStyle;
    const selectedSticker = draft.sticker;
    const styleButtons = STYLE_OPTIONS.map(([value, label]) => `
      <button type="button" class="fb-compose-choice${value === selectedStyle ? " on" : ""}" data-compose-style="${value}">${label}</button>`).join("");
    const paperButtons = PAPER_OPTIONS.map(([value, label]) => `
      <button type="button" class="fb-compose-choice fb-compose-paper${value === selectedPaper ? " on" : ""}" data-compose-paper="${value}">
        <span class="fb-letter-paper-chip ${value}"></span><span>${label}</span>
      </button>`).join("");
    const envelopeButtons = ENVELOPE_OPTIONS.map(([value, label]) => `
      <button type="button" class="fb-compose-choice fb-compose-envelope${value === selectedEnvelope ? " on" : ""}" data-compose-envelope="${value}">
        ${envelopeIcon(value, "mini")}<span>${label}</span>
      </button>`).join("");
    const stickerButtons = [
      `<button type="button" class="fb-compose-sticker-choice${selectedSticker == null || selectedSticker === "" ? " on" : ""}" data-compose-sticker="">不贴</button>`,
      ...STICKER_OPTIONS.map(([value, label]) => `
        <button type="button" class="fb-compose-sticker-choice${value === selectedSticker ? " on" : ""}" data-compose-sticker="${value}">
          ${stickerIcon(value, "mini")}<span>${label}</span>
        </button>`)
    ].join("");

    state.root.innerHTML = `<section class="fb-letter-view fb-letter-compose">
      <button type="button" class="fb-letter-back" data-compose-close>← 返回邮局</button>
      <div class="fb-letter-heading">
        <h2>写一封信</h2>
        <span>TO MY FRIEND</span>
      </div>
      <p class="fb-compose-recipient">写给现在的密友</p>

      <div class="fb-compose-section">
        <div class="fb-compose-label">风格</div>
        <div class="fb-compose-choices fb-compose-styles">${styleButtons}</div>
      </div>

      <div class="fb-compose-section">
        <div class="fb-compose-label">信纸</div>
        <div class="fb-compose-choices fb-compose-papers">${paperButtons}</div>
      </div>

      <div class="fb-compose-section">
        <div class="fb-compose-label">信封</div>
        <div class="fb-compose-choices fb-compose-envelopes">${envelopeButtons}</div>
      </div>

      <div class="fb-compose-section">
        <div class="fb-compose-label">贴纸</div>
        <div class="fb-compose-choices fb-compose-stickers">${stickerButtons}</div>
      </div>

      <div class="fb-compose-section">
        <div class="fb-compose-label-row">
          <span class="fb-compose-label">正文</span>
          <span class="fb-compose-count" data-compose-count>${count} / 2000</span>
        </div>
        <textarea class="fb-compose-body" data-compose-body rows="8" placeholder="写点什么……">${esc(draft.body)}</textarea>
        <div class="fb-compose-error" data-compose-error>${esc(state.composeError)}</div>
      </div>

      <div class="fb-compose-actions">
        <button type="button" class="fb-compose-secondary" data-compose-preview>预览</button>
        <button type="button" class="fb-compose-send" data-compose-send${state.composeSending || count < 1 || count > 2000 ? " disabled" : ""}>${state.composeSending ? "正在寄出……" : "寄出"}</button>
      </div>
    </section>`;
    this.bind();
  },

  renderComposePreview() {
    const draft = state.compose;
    if (!draft || !state.root) return;
    const paper = PAPER_LABEL[draft.paperStyle] || "信纸";
    const envelope = envelopeLabel(draft.envelopeStyle);
    const sticker = STICKER_LABEL[draft.sticker] || "";
    const stickerMarkup = stickerIcon(draft.sticker);
    state.root.innerHTML = `<section class="fb-letter-view fb-letter-compose-preview">
      <button type="button" class="fb-letter-back" data-compose-edit>← 继续编辑</button>
      <div class="fb-letter-heading">
        <h2>信件预览</h2>
        <span>PREVIEW</span>
      </div>
      <div class="fb-letter-meta">
        <span class="fb-letter-sender">写给现在的密友</span>
        <div class="fb-letter-envelope-row">
          ${envelopeIcon(draft.envelopeStyle)}
          <span class="fb-letter-envelope-name">${esc(envelope)}</span>
        </div>
        <span class="fb-letter-paper-name">${esc(paper)}</span>
        ${sticker ? `<span class="fb-letter-sticker-name">贴纸 · ${esc(sticker)}</span>` : ""}
      </div>
      <div class="fb-letter-paper ${esc(draft.paperStyle || "paper-cream")}">
        ${stickerMarkup ? `<div class="fb-letter-sticker-corner">${stickerMarkup}</div>` : ""}
        <p class="fb-letter-body">${esc(draft.body || "")}</p>
      </div>
      <div class="fb-compose-actions">
        <button type="button" class="fb-compose-secondary" data-compose-edit>继续编辑</button>
      </div>
    </section>`;
    this.bind();
  },

  render() {
    if (!state.root) return;
    if (state.detailId) {
      this.renderDetail();
      return;
    }
    if (state.compose) {
      this.renderCompose();
      return;
    }
    if (state.loading && !state.loaded) {
      state.root.innerHTML = `<section class="fb-letter-view">
        <div class="fb-letter-heading"><h2>邮局</h2><span>POST OFFICE</span></div>
        <div class="fb-letter-loading">正在打开邮局……</div>
      </section>`;
      return;
    }
    if (state.error && !state.loaded) {
      state.root.innerHTML = `<section class="fb-letter-view">
        <div class="fb-letter-heading"><h2>邮局</h2><span>POST OFFICE</span></div>
        <div class="fb-letter-error">${esc(state.error)}<button type="button" data-letter-retry>重试</button></div>
      </section>`;
      this.bind();
      return;
    }

    const linked = state.linked;
    const banner = linked ? "" : `<div class="fb-letter-banner">这段密友关系已解除，历史信件仍然可以查看。</div>`;
    const emptyText = linked
      ? "还没有收到信。<br>等一封从远方寄来的信吧。"
      : "这段关系已解除，还没有留下的信。";
    const list = state.letters.length
      ? `<div class="fb-letter-list">${state.letters.map(card).join("")}</div>`
      : `<div class="fb-letter-empty">${emptyText}</div>`;
    const more = state.nextBefore && state.nextBeforeId
      ? `<div class="fb-letter-more"><button type="button" data-letter-more>加载更早的信</button></div>`
      : "";

    state.root.innerHTML = `<section class="fb-letter-view">
      <div class="fb-letter-heading">
        <h2>邮局</h2>
        <div class="fb-letter-heading-actions">
          <span>${state.unread > 0 ? `${state.unread} 封未读` : "POST OFFICE"}</span>
          ${linked ? '<button type="button" class="fb-letter-compose-entry" data-letter-compose>写信</button>' : ""}
        </div>
      </div>
      ${banner}
      <div class="fb-letter-subhead"><span>收件箱</span><small>INBOX</small></div>
      ${state.error ? `<div class="fb-letter-inline-error">${esc(state.error)}</div>` : ""}
      ${state.loaded ? list : ""}
      ${state.loaded ? more : ""}
    </section>`;
    this.bind();
  },

  bind() {
    if (!state.root) return;
    const retry = $("[data-letter-retry]", state.root);
    if (retry) retry.addEventListener("click", () => this.load());

    const more = $("[data-letter-more]", state.root);
    if (more) more.addEventListener("click", () => this.loadMore());

    const back = $("[data-letter-back]", state.root);
    if (back) back.addEventListener("click", () => this.closeDetail());

    const detailRetry = $("[data-letter-detail-retry]", state.root);
    if (detailRetry) detailRetry.addEventListener("click", () => {
      const id = state.detailId;
      if (!id) return;
      state.detailId = null;
      this.openDetail(id);
    });

    state.root.querySelectorAll("[data-letter-open]").forEach((el) => {
      el.addEventListener("click", () => this.openDetail(el.dataset.letterOpen));
      el.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.openDetail(el.dataset.letterOpen);
        }
      });
    });

    state.root.querySelectorAll("[data-letter-compose]").forEach((el) => {
      el.addEventListener("click", () => this.openCompose());
    });

    const composeClose = $("[data-compose-close]", state.root);
    if (composeClose) composeClose.addEventListener("click", () => this.closeCompose());

    state.root.querySelectorAll("[data-compose-edit]").forEach((el) => {
      el.addEventListener("click", () => {
        state.composePreview = false;
        this.renderCompose();
      });
    });

    state.root.querySelectorAll("[data-compose-style]").forEach((el) => {
      el.addEventListener("click", () => {
        if (!state.compose) return;
        state.compose.style = el.dataset.composeStyle;
        this.renderCompose();
      });
    });

    state.root.querySelectorAll("[data-compose-paper]").forEach((el) => {
      el.addEventListener("click", () => {
        if (!state.compose) return;
        state.compose.paperStyle = el.dataset.composePaper;
        this.renderCompose();
      });
    });

    state.root.querySelectorAll("[data-compose-envelope]").forEach((el) => {
      el.addEventListener("click", () => {
        if (!state.compose) return;
        state.compose.envelopeStyle = el.dataset.composeEnvelope;
        this.renderCompose();
      });
    });

    state.root.querySelectorAll("[data-compose-sticker]").forEach((el) => {
      el.addEventListener("click", () => {
        if (!state.compose) return;
        state.compose.sticker = el.dataset.composeSticker || null;
        this.renderCompose();
      });
    });

    const composeBody = $("[data-compose-body]", state.root);
    if (composeBody) {
      composeBody.addEventListener("input", () => this.updateComposeCounter());
    }

    const composePreview = $("[data-compose-preview]", state.root);
    if (composePreview) composePreview.addEventListener("click", () => {
      if (!state.compose) return;
      state.composePreview = true;
      this.renderCompose();
    });

    const composeSend = $("[data-compose-send]", state.root);
    if (composeSend) composeSend.addEventListener("click", () => this.sendCompose());
  }
};
