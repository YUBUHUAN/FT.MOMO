/* Bubble, particles, small sounds, blinking. */
import { clamp } from "./util.js";

const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export class Bubble {
  constructor(root, textEl, markEl) {
    this.root = root;
    this.textEl = textEl;
    this.markEl = markEl;
    this.token = 0;
    this.hideTimer = null;
    this.typeTimer = null;
  }

  show(text, opts = {}) {
    const dots = !!opts.dots;
    const mark = opts.mark || "";
    const typing = opts.typing !== false && !dots && !reduced;
    const duration = opts.duration == null ? 5200 : opts.duration;
    this.token += 1;
    const token = this.token;
    clearTimeout(this.hideTimer);
    clearInterval(this.typeTimer);
    this.root.classList.add("show");
    this.root.classList.toggle("dots", dots);
    this.textEl.classList.remove("typing");
    this.markEl.textContent = mark;
    this.root.setAttribute("aria-live", "polite");

    if (!typing) {
      this.textEl.textContent = text;
    } else {
      const chars = Array.from(String(text));
      let i = 0;
      this.textEl.textContent = "";
      this.textEl.classList.add("typing");
      this.typeTimer = setInterval(() => {
        if (token !== this.token) return clearInterval(this.typeTimer);
        i += 1;
        this.textEl.textContent = chars.slice(0, i).join("");
        if (i >= chars.length) {
          clearInterval(this.typeTimer);
          this.textEl.classList.remove("typing");
        }
      }, 26);
    }

    if (duration > 0) {
      this.hideTimer = setTimeout(() => {
        if (token === this.token) this.hide();
      }, duration);
    }
  }

  hide() {
    this.token += 1;
    clearTimeout(this.hideTimer);
    clearInterval(this.typeTimer);
    this.root.classList.remove("show");
    this.textEl.classList.remove("typing");
  }
}

const FX_SETS = {
  hearts: ["♡", "❤", "✦", "·"],
  happy: ["✦", "✧", "♡", "☁"],
  dizzy: ["✦", "✧", "💫", "◎"],
  crumbs: ["·", "•", "✧"],
  night: ["✧", "·", "☾"]
};

export function burst(layer, kind = "hearts", count = 4, origin = {}) {
  if (!layer) return;
  const set = FX_SETS[kind] || FX_SETS.hearts;
  for (let i = 0; i < count; i++) {
    const node = document.createElement("span");
    node.className = "fx";
    node.textContent = set[Math.floor(Math.random() * set.length)];
    const x0 = (origin.x || 0) + (Math.random() * 140 - 70);
    const y0 = (origin.y || 0) + (Math.random() * 40 - 10);
    node.style.setProperty("--x0", `${x0}px`);
    node.style.setProperty("--y0", `${y0}px`);
    node.style.setProperty("--dx", `${Math.random() * 70 - 35}px`);
    node.style.setProperty("--dy", `${-90 - Math.random() * 90}px`);
    node.style.setProperty("--rot", `${Math.random() * 50 - 25}deg`);
    node.style.animationDelay = `${i * 34}ms`;
    layer.appendChild(node);
    setTimeout(() => node.remove(), 1500 + i * 40);
  }
}

export function foodFly(layer, emoji) {
  if (!layer) return;
  const node = document.createElement("span");
  node.className = "fx food";
  node.textContent = emoji || "🍰";
  node.style.setProperty("--x0", `${Math.random() * 60 - 30}px`);
  node.style.setProperty("--y0", "110px");
  node.style.animationDelay = "60ms";
  layer.appendChild(node);
  setTimeout(() => node.remove(), 1200);
}

export function toast(text, ms = 2300) {
  const node = document.getElementById("toast");
  if (!node) return;
  node.textContent = text;
  node.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => node.classList.remove("show"), ms);
}

export function moodToast(text, tone = "good") {
  const node = document.getElementById("moodToast");
  if (!node) return;
  node.textContent = text;
  node.style.background = tone === "bad" ? "var(--danger)" : "var(--ink)";
  node.classList.add("show");
  clearTimeout(moodToast._t);
  moodToast._t = setTimeout(() => node.classList.remove("show"), 2000);
}

export function startBlinking(body) {
  if (!body || reduced) return;
  let timer = null;
  const loop = () => {
    body.classList.add("blink");
    setTimeout(() => body.classList.remove("blink"), 150);
    timer = setTimeout(loop, 3800 + Math.random() * 4200);
  };
  timer = setTimeout(loop, 2400);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearTimeout(timer);
    } else {
      clearTimeout(timer);
      timer = setTimeout(loop, 1800);
    }
  });
}

export class Sfx {
  constructor(enabled = true) {
    this.enabled = enabled;
    this.ctx = null;
  }

  setEnabled(v) {
    this.enabled = !!v;
  }

  unlock() {
    if (!this.enabled) return;
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  }

  tone(freq, duration = 0.16, type = "sine", gain = 0.022, delay = 0) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1650, t0);
    filter.Q.setValueAtTime(0.55, t0);
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.linearRampToValueAtTime(gain, t0 + 0.03);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(amp).connect(filter).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.04);
  }

  play(kind, n = 1) {
    if (!this.enabled) return;
    this.unlock();
    if (!this.ctx) return;
    switch (kind) {
      case "tap":
        this.tone(430 + clamp(n, 1, 12) * 15, 0.16, "sine", 0.017);
        break;
      case "boop":
        this.tone(330, 0.14, "triangle", 0.02);
        this.tone(440, 0.18, "triangle", 0.016, 0.05);
        break;
      case "feed":
        [392, 523.25, 659.25].forEach((f, i) => this.tone(f, 0.24, "triangle", 0.022, i * 0.07));
        break;
      case "outing":
        [329.63, 392, 523.25, 659.25].forEach((f, i) => this.tone(f, 0.28, "sine", 0.02, i * 0.09));
        break;
      case "recap":
        [523.25, 659.25, 783.99].forEach((f, i) => this.tone(f, 0.34, "triangle", 0.02, i * 0.08));
        break;
      case "error":
        this.tone(196, 0.2, "sine", 0.02);
        this.tone(174.61, 0.24, "sine", 0.018, 0.1);
        break;
      case "open":
        this.tone(440, 0.15, "sine", 0.015);
        this.tone(659.25, 0.18, "sine", 0.013, 0.06);
        break;
      default:
        this.tone(520, 0.16, "sine", 0.015);
    }
  }
}
