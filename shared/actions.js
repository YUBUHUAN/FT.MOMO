/* Shared action dispatcher.
 * The Node server and the cloud/browser client both use this switch so a tap,
 * feed, outing or reset behaves identically in every place.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MomoActions = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function engineFor() {
    if (typeof module === "object" && module.exports) return require("./engine.js");
    return typeof globalThis !== "undefined" ? globalThis.MomoEngine : null;
  }

  function applyAction(state, content, action, now, rng) {
    const engine = engineFor();
    const a = action || {};
    const t = a.type;
    let result = { ok: true };

    switch (t) {
      case "tap":
        result = engine.applyTap(state, content, a.count, now);
        break;
      case "feed":
        result = engine.applyFeed(state, content, a.itemId, a.optionId, now);
        break;
      case "outing_start":
        result = engine.startOuting(state, content, a.placeId, a.minutes, now);
        break;
      case "outing_finish":
        if (!state.outing) result = { ok: false, error: "not_away" };
        else result = engine.finishOuting(state, content, now, !!a.early) || { ok: false };
        break;
      case "outing_seen":
        result = engine.markRecapSeen(state, now);
        break;
      case "exercise_start":
        result = engine.startExercise(state, content, a.kindId, a.minutes, now);
        break;
      case "exercise_finish":
        if (!state.exercise) result = { ok: false, error: "not_exercising" };
        else result = engine.finishExercise(state, content, now, !!a.early) || { ok: false };
        break;
      case "exercise_seen":
        result = engine.markExerciseSeen(state, now);
        break;
      case "set_background":
        result = engine.setBackground(state, content, a.background, now);
        break;
      case "heartbeat":
        result = engine.heartbeat(state, content, !!a.visible, now);
        break;
      case "rename": {
        const name = engine.validateName(a.name);
        if (!name) result = { ok: false, error: "bad_name" };
        else {
          state.name = name;
          state.rev = (state.rev || 0) + 1;
          result = { ok: true, name };
        }
        break;
      }
      case "reset":
        if (a.confirm !== state.createdAt) {
          result = { ok: false, error: "confirm_required" };
        } else {
          const fresh = engine.newState(now, state.name);
          fresh.createdAt = state.createdAt;
          fresh.totals.days = 1;
          for (const k of Object.keys(state)) delete state[k];
          Object.assign(state, fresh);
          result = { ok: true };
        }
        break;
      default:
        result = { ok: false, error: "unknown_action" };
    }

    result.ok = result.ok !== false;
    return result;
  }

  return { applyAction };
});
