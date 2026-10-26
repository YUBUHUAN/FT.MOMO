/* Thin adapter around the Electron preload bridge.
 * In a plain browser every call degrades gracefully so the same UI runs on
 * Android as an installable web app.
 */
const bridge = typeof window !== "undefined" ? window.MomoShell : null;
const SETTINGS_KEY = "momo.settings";
const DEFAULTS = { sound: true, alwaysOnTop: true, autoLaunch: false };

function readLocal() {
  try {
    return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"));
  } catch (_) {
    return Object.assign({}, DEFAULTS);
  }
}

export const Shell = {
  isElectron: !!bridge,
  platform: bridge ? bridge.platform : "web",

  async getSettings() {
    if (bridge) {
      try {
        return await bridge.getSettings();
      } catch (_) {
        /* fall through */
      }
    }
    return readLocal();
  },

  async setSetting(key, value) {
    if (bridge) {
      return await bridge.setSetting(key, value);
    }
    const next = Object.assign(readLocal(), { [key]: value });
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("momo:settings", { detail: next }));
    return next;
  },

  onSettings(cb) {
    if (bridge && bridge.onSettings) return bridge.onSettings(cb);
    const handler = (e) => {
      if (e.key === SETTINGS_KEY) cb(readLocal());
    };
    window.addEventListener("storage", handler);
    window.addEventListener("momo:settings", (e) => cb(e.detail));
    return () => window.removeEventListener("storage", handler);
  },

  openProfile() {
    if (bridge) return bridge.openProfile();
    const back = encodeURIComponent(location.pathname + location.search);
    location.href = `/profile.html?from=${back}`;
  },

  closeProfile() {
    if (bridge && bridge.closeProfile) return bridge.closeProfile();
    if (document.referrer && document.referrer.includes(location.host)) history.back();
    else location.href = "/";
  },

  hide() {
    if (bridge) bridge.hide();
  },

  quit() {
    if (bridge) bridge.quit();
  },

  setIgnore(ignore) {
    if (bridge) bridge.setIgnore(ignore);
  },

  dragStart() {
    if (bridge) bridge.dragStart();
  },

  dragMove(screenX, screenY) {
    if (bridge) bridge.dragMove(screenX, screenY);
  },

  dragEnd() {
    if (bridge) bridge.dragEnd();
  },

  resetPosition() {
    if (bridge) return bridge.resetPosition();
    return false;
  },

  async copy(text) {
    if (bridge && bridge.copyText) {
      await bridge.copyText(String(text));
      return true;
    }
    try {
      await navigator.clipboard.writeText(String(text));
      return true;
    } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = String(text);
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    }
  },

  async info() {
    if (bridge && bridge.getInfo) {
      try {
        return await bridge.getInfo();
      } catch (_) {
        /* ignore */
      }
    }
    return { version: "web", platform: "web", url: location.origin };
  },

  openExternal(url) {
    if (bridge && bridge.openExternal) bridge.openExternal(url);
    else window.open(url, "_blank", "noopener");
  }
};
