/* Supabase cloud backend for MomoPet.
 * Uses the public publishable key only. All access goes through the RPC
 * functions in cloud/schema.sql; tables are not exposed directly.
 */
"use strict";

const fs = require("fs");
const path = require("path");

function loadConfig(explicitPath) {
  const file = explicitPath || process.env.MOMO_CLOUD || path.join(__dirname, "..", "cloud.json");
  try {
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw || !raw.url || !raw.key) return null;
    return { url: String(raw.url).replace(/\/+$/, "").replace(/\/rest\/v1$/, ""), key: String(raw.key) };
  } catch (_) {
    return null;
  }
}

class CloudError extends Error {
  constructor(message, status = 0, body = null) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

class CloudBackend {
  constructor(config) {
    this.url = config.url;
    this.key = config.key;
    this.ready = Promise.resolve();
  }

  async rpc(name, args = {}, timeoutMs = 15000) {
    if (typeof fetch !== "function") throw new CloudError("fetch_unavailable");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.url}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: {
          apikey: this.key,
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify(args || {}),
        signal: controller.signal
      });
      const text = await res.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
      if (!res.ok) {
        const message = (body && body.message) || (body && body.error) || `cloud_${res.status}`;
        throw new CloudError(message, res.status, body);
      }
      if (body && typeof body === "object") return body;
      throw new CloudError("cloud_bad_response", res.status, body);
    } catch (err) {
      if (err && err.name === "AbortError") throw new CloudError("cloud_timeout");
      if (err instanceof CloudError) throw err;
      throw new CloudError("cloud_network", 0, String(err && err.message ? err.message : err));
    } finally {
      clearTimeout(timer);
    }
  }

  async register(username, password) {
    return this.rpc("momo_register", { p_username: username, p_password: password });
  }

  async login(username, password) {
    return this.rpc("momo_login", { p_username: username, p_password: password });
  }

  async me(token) {
    return this.rpc("momo_me", { p_token: token });
  }

  async logout(token) {
    return this.rpc("momo_logout", { p_token: token });
  }

  async getState(token) {
    const out = await this.rpc("momo_get_state", { p_token: token });
    if (out && out.ok === false) return out;
    return {
      ok: true,
      state: out && out.state && typeof out.state === "object" ? out.state : null,
      rev: Number(out && out.rev || 0),
      updatedAt: out && out.updatedAt
    };
  }

  async saveState(token, state, baseRev) {
    return this.rpc("momo_save_state", {
      p_token: token,
      p_state: state,
      p_base_rev: baseRev == null ? null : Number(baseRev)
    });
  }
}

function createCloudBackend(config) {
  if (!config || !config.url || !config.key) return null;
  return new CloudBackend(config);
}

module.exports = { CloudBackend, CloudError, createCloudBackend, loadConfig };
