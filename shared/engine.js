/* MomoPet shared engine.
 * Pure state transitions used by both the Node sync server and the browser.
 * UMD, zero dependencies.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MomoEngine = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const MOOD_MIN = 0;
  const MOOD_MAX = 100;
  const START_MOOD = 64;
  const START_FULLNESS = 34;
  const START_HEALTH = 70;
  const START_FATIGUE = 8;
  const FATIGUE_REFUSE = 85;
  const FULL_REFUSE = 94;
  const FULL_SOFT = 76;
  const MAX_FEED_LOG = 20;
  const MAX_OUTING_HISTORY = 16;
  const MAX_EXERCISE_HISTORY = 20;
  const MAX_DAILY = 60;
  const TAP_WINDOW_MS = 1500;
  const FULLNESS_PER_HOUR = 1.2;
  const FATIGUE_PER_HOUR = 1.0;
  const HEALTH_PER_HOUR = 0.35;
  const HUNGRY_AT = 25;
  const STARVING_AT = 10;
  const VITALS_STEP_MS = 36000;

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function todayKey(now) {
    const d = now instanceof Date ? now : new Date(now);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function dayIndex(now) {
    const d = now instanceof Date ? now : new Date(now);
    return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400000);
  }

  function pick(arr, rng) {
    if (!arr || !arr.length) return "";
    const r = (rng || Math.random)();
    return arr[Math.floor(r * arr.length) % arr.length];
  }

  function clampState(state) {
    state.mood = round1(clamp(Number(state.mood) || 0, MOOD_MIN, MOOD_MAX));
    state.fullness = round1(clamp(Number(state.fullness) || 0, 0, 100));
    return state;
  }

  function newState(nowMs, name) {
    const now = new Date(nowMs || Date.now());
    const key = todayKey(now);
    const state = {
      v: 1,
      rev: 1,
      name: name || "墨墨",
      mood: START_MOOD,
      fullness: START_FULLNESS,
      health: START_HEALTH,
      fatigue: START_FATIGUE,
      background: "home",
      sleeping: false,
      createdAt: now.toISOString(),
      lastCareAt: now.toISOString(),
      lastVitalsAt: now.toISOString(),
      lastHungerLevel: "ok",
      lastInteractionAt: now.toISOString(),
      lastSeenAt: null,
      lastHeartbeatAt: null,
      today: key,
      daily: {},
      totals: { taps: 0, feeds: 0, outings: 0, exercises: 0, activeSeconds: 0, days: 1 },
      feedLog: [],
      outing: null,
      lastOuting: null,
      outingHistory: [],
      exercise: null,
      lastExercise: null,
      exerciseHistory: [],
      lastTapAt: 0,
      tapBursts: 0,
      lastRecapSeenAt: null
    };
    state.daily[key] = { activeSeconds: 0, taps: 0, feeds: 0, outings: 0, exercises: 0, mood: state.mood };
    return state;
  }

  function ensureDay(state, now) {
    const key = todayKey(now);
    if (state.today === key) return false;
    // Keep the previous day's closing mood before moving on.
    if (state.daily[state.today]) state.daily[state.today].mood = state.mood;
    state.today = key;
    if (!state.daily[key]) {
      state.daily[key] = { activeSeconds: 0, taps: 0, feeds: 0, outings: 0, exercises: 0, mood: state.mood };
    }
    const keys = Object.keys(state.daily).sort();
    while (keys.length > MAX_DAILY) {
      delete state.daily[keys.shift()];
    }
    return true;
  }

  function hungerLevel(state) {
    const fullness = Number(state.fullness) || 0;
    if (fullness <= STARVING_AT) return "starving";
    if (fullness <= HUNGRY_AT) return "hungry";
    return "ok";
  }

  function applyVitals(state, now, events) {
    const last = Date.parse(state.lastVitalsAt || state.lastCareAt || state.createdAt || 0);
    if (!last) {
      state.lastVitalsAt = new Date(now).toISOString();
      state.lastHungerLevel = hungerLevel(state);
      return;
    }
    const elapsed = now - last;
    if (elapsed < VITALS_STEP_MS) return;

    const hours = Math.max(0, elapsed / 3600000);
    const beforeFullness = Number(state.fullness) || 0;
    state.fullness = round1(clamp(beforeFullness - hours * FULLNESS_PER_HOUR, 0, 100));
    const restful = state.sleeping === true;
    state.fatigue = round1(clamp((Number(state.fatigue) || 0) - hours * (restful ? 2.0 : FATIGUE_PER_HOUR), 0, 100));

    // Health drops slowly all the time, faster when she is hungry or very tired.
    // A good sleep rests her body instead of draining it.
    let healthRate = restful ? 0.12 : HEALTH_PER_HOUR;
    if (state.fullness <= HUNGRY_AT) healthRate += 0.25;
    if (state.fullness <= STARVING_AT) healthRate += 0.45;
    if (state.fatigue >= 82) healthRate += 0.2;
    state.health = round1(clamp((Number(state.health) || 0) - hours * healthRate, 0, 100));

    // Hunger drags her mood down a little.
    if (state.fullness <= HUNGRY_AT) {
      const moodRate = state.fullness <= STARVING_AT ? 0.55 : 0.22;
      state.mood = round1(clamp((Number(state.mood) || 0) - hours * moodRate, MOOD_MIN, MOOD_MAX));
    } else {
      const lastTalk = Date.parse(state.lastInteractionAt || state.createdAt || now);
      if (now - lastTalk > 8 * 3600000) {
        state.mood = round1(clamp((Number(state.mood) || 0) - Math.min(7, hours * 0.32), MOOD_MIN, MOOD_MAX));
      }
    }

    state.lastVitalsAt = new Date(now).toISOString();
    const level = hungerLevel(state);
    if (level !== (state.lastHungerLevel || "ok")) {
      if (level !== "ok") events.push({ type: "hungry", level, fullness: state.fullness });
      state.lastHungerLevel = level;
    }
  }

  function normalize(state, content, nowMs) {
    const now = nowMs || Date.now();
    const events = [];
    ensureDay(state, now);
    if (typeof state.health !== "number" || !Number.isFinite(state.health)) state.health = START_HEALTH;
    if (typeof state.fatigue !== "number" || !Number.isFinite(state.fatigue)) state.fatigue = START_FATIGUE;
    if (!Array.isArray(state.exerciseHistory)) state.exerciseHistory = [];
    if (typeof state.sleeping !== "boolean") state.sleeping = false;
    if (typeof state.background !== "string" || !content.SCENES.some((sc) => sc.id === state.background)) {
      state.background = "home";
    }
    if (!state.totals) state.totals = {};
    state.totals.exercises = Number(state.totals.exercises) || 0;

    applyVitals(state, now, events);

    if (state.exercise && now >= state.exercise.endsAt) {
      const result = finishExercise(state, content, now, false);
      if (result) events.push({ type: "exercise_done", result });
    }

    if (state.outing && now >= state.outing.endsAt) {
      const result = finishOuting(state, content, now, false);
      if (result) events.push({ type: "outing_done", result });
    }

    const today = state.daily[state.today];
    if (today) today.mood = state.mood;
    return events;
  }

  function currentDaily(state) {
    if (!state.daily[state.today]) {
      state.daily[state.today] = { activeSeconds: 0, taps: 0, feeds: 0, outings: 0, exercises: 0, mood: state.mood };
    }
    return state.daily[state.today];
  }

  function moodLabel(mood, content) {
    const labels = (content && content.MOOD_LABELS) || [];
    for (const m of labels) if (mood >= m.min) return m;
    return labels[labels.length - 1] || { min: 0, label: "平静", emoji: "🍃", note: "" };
  }

  function applyTap(state, content, count, nowMs) {
    const now = nowMs || Date.now();
    normalize(state, content, now);
    const n = Math.max(1, Math.min(50, Math.floor(Number(count) || 1)));
    const burst = state.lastTapAt && now - state.lastTapAt < TAP_WINDOW_MS * 3;
    state.tapBursts = burst ? (state.tapBursts || 0) + n : n;
    state.lastTapAt = now;
    state.lastInteractionAt = new Date(now).toISOString();

    let gain = Math.min(n, 3) * 0.5;
    let penalty = 0;
    if (n > 8) penalty = Math.min(10, (n - 8) * 0.6);
    const before = state.mood;
    state.mood = round1(clamp(state.mood + gain - penalty, MOOD_MIN, MOOD_MAX));
    const daily = currentDaily(state);
    daily.taps += n;
    state.totals.taps += n;
    state.rev = (state.rev || 0) + 1;
    return { count: n, moodDelta: round1(state.mood - before), mood: state.mood };
  }

  function findFeed(content, itemId, optionId) {
    const item = content.FEED.find((i) => i.id === itemId);
    if (!item) return null;
    const option = item.options.find((o) => o.id === optionId);
    if (!option) return null;
    return { item, option };
  }

  function applyFeed(state, content, itemId, optionId, nowMs, rng) {
    const now = nowMs || Date.now();
    normalize(state, content, now);
    const found = findFeed(content, itemId, optionId);
    if (!found) return { ok: false, error: "unknown_food" };
    if (state.outing) return { ok: false, error: "away" };
    if (state.exercise) return { ok: false, error: "busy" };

    const { item, option } = found;
    if (state.fullness >= FULL_REFUSE) {
      return {
        ok: true,
        refused: true,
        line: "唔……真的吃不下啦。你先放在一边，我待会儿再吃，好不好？",
        item: { id: item.id, name: item.name, emoji: item.emoji },
        option: { id: option.id, label: option.label },
        moodDelta: 0,
        fullnessDelta: 0,
        healthDelta: 0,
        mood: state.mood,
        fullness: state.fullness,
        health: state.health
      };
    }

    const soft = state.fullness >= FULL_SOFT;
    const moodDelta = round1(option.mood * (soft ? 0.5 : 1));
    const fullnessDelta = option.fullness;
    const healthDelta = round1(option.health != null ? option.health : 1);
    state.mood = round1(clamp(state.mood + moodDelta, MOOD_MIN, MOOD_MAX));
    state.fullness = round1(clamp(state.fullness + fullnessDelta, 0, 100));
    state.health = round1(clamp(state.health + healthDelta, 0, 100));
    state.lastInteractionAt = new Date(now).toISOString();
    state.lastCareAt = new Date(now).toISOString();

    let line = pick(option.lines, rng);
    if (soft) line += "（有点撑……）";

    const daily = currentDaily(state);
    daily.feeds += 1;
    daily.mood = state.mood;
    state.totals.feeds += 1;
    const entry = {
      at: new Date(now).toISOString(),
      itemId: item.id,
      itemName: item.name,
      emoji: item.emoji,
      optionId: option.id,
      optionLabel: option.label,
      line,
      moodDelta,
      healthDelta
    };
    state.feedLog.unshift(entry);
    if (state.feedLog.length > MAX_FEED_LOG) state.feedLog.length = MAX_FEED_LOG;
    state.rev = (state.rev || 0) + 1;

    return {
      ok: true,
      refused: false,
      line,
      item: { id: item.id, name: item.name, emoji: item.emoji },
      option: { id: option.id, label: option.label },
      moodDelta,
      fullnessDelta,
      healthDelta,
      soft,
      mood: state.mood,
      fullness: state.fullness,
      health: state.health
    };
  }

  function findOuting(content, placeId, minutes) {
    const place = content.OUTINGS.find((p) => p.id === placeId);
    if (!place) return null;
    const plan = place.durations[minutes];
    if (!plan) return null;
    return { place, plan };
  }

  function startOuting(state, content, placeId, minutes, nowMs) {
    const now = nowMs || Date.now();
    normalize(state, content, now);
    if (state.outing) return { ok: false, error: "already_away" };
    if (state.exercise) return { ok: false, error: "busy" };
    const found = findOuting(content, placeId, minutes);
    if (!found) return { ok: false, error: "unknown_outing" };
    const { place, plan } = found;
    state.outing = {
      placeId: place.id,
      name: place.name,
      emoji: place.emoji,
      scene: place.scene,
      minutes,
      startedAt: now,
      endsAt: now + minutes * 60000,
      moodPreview: plan.mood,
      fatiguePreview: plan.fatigue != null ? plan.fatigue : (minutes <= 10 ? 2 : 5),
      line: pick(plan.lines)
    };
    state.lastInteractionAt = new Date(now).toISOString();
    state.rev = (state.rev || 0) + 1;
    return { ok: true, outing: state.outing, line: state.outing.line };
  }

  function finishOuting(state, content, nowMs, early, rng) {
    const now = nowMs || Date.now();
    if (!state.outing) return null;
    const outing = state.outing;
    const found = findOuting(content, outing.placeId, outing.minutes);
    if (!found) {
      state.outing = null;
      return null;
    }
    const total = outing.minutes * 60000;
    const elapsed = Math.max(0, now - outing.startedAt);
    const ratio = clamp(elapsed / total, 0, 1);
    if (early && ratio < 0.08) {
      const cancelled = {
        ok: true,
        early: true,
        cancelled: true,
        placeId: outing.placeId,
        name: found.place.name,
        emoji: found.place.emoji,
        scene: found.place.scene,
        minutes: outing.minutes,
        actualMinutes: 0,
        moodDelta: 0,
        fullnessDelta: 0,
        fatigueDelta: 0,
        line: "刚出门就回来了……我还没想好要去哪里呢。",
        surprise: "走到门口才发现忘了带钥匙。",
        souvenir: "🔑",
        mood: state.mood,
        fullness: state.fullness,
        fatigue: state.fatigue,
        at: new Date(now).toISOString()
      };
      state.outing = null;
      if (!Array.isArray(state.outingHistory)) state.outingHistory = [];
      state.outingHistory.unshift(cancelled);
      if (state.outingHistory.length > MAX_OUTING_HISTORY) state.outingHistory.length = MAX_OUTING_HISTORY;
      state.rev = (state.rev || 0) + 1;
      return cancelled;
    }
    const factor = early ? Math.max(0.3, ratio) : 1;
    const bonus = early ? 0 : Math.floor((rng || Math.random)() * 3);
    const moodDelta = round1((found.plan.mood + bonus) * factor);
    const fullnessDelta = round1(found.plan.fullness * (early ? Math.max(0.3, ratio) : 1));
    const fatigueDelta = round1((found.plan.fatigue != null ? found.plan.fatigue : (outing.minutes <= 10 ? 2 : 5)) * (early ? Math.max(0.3, ratio) : 1));
    state.mood = round1(clamp(state.mood + moodDelta, MOOD_MIN, MOOD_MAX));
    state.fullness = round1(clamp(state.fullness - fullnessDelta, 0, 100));
    state.fatigue = round1(clamp(state.fatigue + fatigueDelta, 0, 100));
    state.lastInteractionAt = new Date(now).toISOString();
    state.lastCareAt = new Date(now).toISOString();

    const result = {
      ok: true,
      early: !!early,
      placeId: outing.placeId,
      name: found.place.name,
      emoji: found.place.emoji,
      scene: found.place.scene,
      minutes: outing.minutes,
      actualMinutes: Math.max(0, Math.round(elapsed / 60000)),
      moodDelta,
      fullnessDelta,
      fatigueDelta,
      line: pick(found.plan.lines, rng),
      souvenir: pick(found.plan.souvenirs, rng),
      surprise: pick(found.place.surprises || [], rng) || "路边捡到一颗小石子。",
      mood: state.mood,
      fullness: state.fullness,
      fatigue: state.fatigue,
      at: new Date(now).toISOString()
    };
    state.lastOuting = Object.assign({ unseen: true }, result);
    state.outing = null;
    const daily = currentDaily(state);
    daily.outings += 1;
    daily.mood = state.mood;
    state.totals.outings += 1;
    state.outingHistory.unshift(result);
    if (state.outingHistory.length > MAX_OUTING_HISTORY) state.outingHistory.length = MAX_OUTING_HISTORY;
    state.rev = (state.rev || 0) + 1;
    return result;
  }


  function findExercise(content, kindId, minutes) {
    const kind = content.EXERCISES.find((e) => e.id === kindId);
    if (!kind) return null;
    const plan = kind.durations[minutes];
    if (!plan) return null;
    return { kind, plan };
  }

  function startExercise(state, content, kindId, minutes, nowMs) {
    const now = nowMs || Date.now();
    normalize(state, content, now);
    if (state.outing) return { ok: false, error: "away" };
    if (state.exercise) return { ok: false, error: "already_exercising" };
    if (state.fatigue >= FATIGUE_REFUSE) {
      return { ok: false, error: "tired", line: pick(content.EXERCISE_TIRED_LINES) };
    }
    const found = findExercise(content, kindId, minutes);
    if (!found) return { ok: false, error: "unknown_exercise" };
    const { kind, plan } = found;
    state.exercise = {
      kindId: kind.id,
      name: kind.name,
      emoji: kind.emoji,
      scene: kind.scene,
      minutes,
      startedAt: now,
      endsAt: now + minutes * 60000,
      healthPreview: plan.health,
      fatiguePreview: plan.fatigue,
      line: pick(kind.preview)
    };
    state.lastInteractionAt = new Date(now).toISOString();
    state.rev = (state.rev || 0) + 1;
    return { ok: true, exercise: state.exercise, line: state.exercise.line };
  }

  function finishExercise(state, content, nowMs, early, rng) {
    const now = nowMs || Date.now();
    if (!state.exercise) return null;
    const exercise = state.exercise;
    const found = findExercise(content, exercise.kindId, exercise.minutes);
    if (!found) {
      state.exercise = null;
      return null;
    }
    const total = exercise.minutes * 60000;
    const elapsed = Math.max(0, now - exercise.startedAt);
    const ratio = clamp(elapsed / total, 0, 1);
    const factor = early ? Math.max(0.2, ratio) : 1;
    const healthDelta = round1(found.plan.health * factor);
    const fatigueDelta = round1(found.plan.fatigue * factor);
    const moodDelta = round1((found.plan.mood || 0) * (early ? 0.6 : 1));
    state.health = round1(clamp(state.health + healthDelta, 0, 100));
    state.fatigue = round1(clamp(state.fatigue + fatigueDelta, 0, 100));
    state.mood = round1(clamp(state.mood + moodDelta, MOOD_MIN, MOOD_MAX));
    state.lastInteractionAt = new Date(now).toISOString();
    state.lastCareAt = new Date(now).toISOString();

    const result = {
      ok: true,
      early: !!early,
      kindId: exercise.kindId,
      name: found.kind.name,
      emoji: found.kind.emoji,
      scene: found.kind.scene,
      minutes: exercise.minutes,
      actualMinutes: Math.max(1, Math.round(elapsed / 60000)),
      healthDelta,
      fatigueDelta,
      moodDelta,
      line: pick(found.plan.lines, rng),
      health: state.health,
      fatigue: state.fatigue,
      mood: state.mood,
      at: new Date(now).toISOString()
    };
    state.lastExercise = Object.assign({ unseen: true }, result);
    state.exercise = null;
    const daily = currentDaily(state);
    daily.exercises = (Number(daily.exercises) || 0) + 1;
    daily.mood = state.mood;
    state.totals.exercises += 1;
    state.exerciseHistory.unshift(result);
    if (state.exerciseHistory.length > MAX_EXERCISE_HISTORY) state.exerciseHistory.length = MAX_EXERCISE_HISTORY;
    state.rev = (state.rev || 0) + 1;
    return result;
  }

  function markExerciseSeen(state, nowMs) {
    if (state.lastExercise) state.lastExercise.unseen = false;
    state.lastExerciseSeenAt = new Date(nowMs || Date.now()).toISOString();
    state.rev = (state.rev || 0) + 1;
    return { ok: true };
  }

  function markRecapSeen(state, nowMs) {
    if (state.lastOuting) state.lastOuting.unseen = false;
    state.lastRecapSeenAt = new Date(nowMs || Date.now()).toISOString();
    state.rev = (state.rev || 0) + 1;
    return { ok: true };
  }

  function heartbeat(state, content, visible, nowMs) {
    const now = nowMs || Date.now();
    normalize(state, content, now);
    const prev = state.lastHeartbeatAt ? Date.parse(state.lastHeartbeatAt) : 0;
    if (visible) {
      if (prev && now - prev > 0 && now - prev < 90000) {
        const add = Math.min((now - prev) / 1000, 60);
        const daily = currentDaily(state);
        daily.activeSeconds = Math.round((daily.activeSeconds + add) * 10) / 10;
        state.totals.activeSeconds = Math.round((state.totals.activeSeconds + add) * 10) / 10;
      }
      state.lastHeartbeatAt = new Date(now).toISOString();
    } else {
      state.lastHeartbeatAt = null;
    }
    state.lastSeenAt = new Date(now).toISOString();
    return { ok: true };
  }

  function tapLine(state, content, nowMs, rng) {
    const now = nowMs || Date.now();
    const hour = new Date(now).getHours();
    const recentSpam = state.lastTapAt && now - state.lastTapAt < 8000 && (state.tapBursts || 0) >= 6;
    if (recentSpam && (rng || Math.random)() < 0.9) {
      return pick(content.TAP_LINES.after_spam, rng);
    }
    const level = hungerLevel(state);
    if (level !== "ok" && content.HUNGER_LINES && content.HUNGER_LINES[level]) {
      return pick(content.HUNGER_LINES[level], rng);
    }
    const pool = [];
    const lastTalk = Date.parse(state.lastInteractionAt || 0);
    if (lastTalk && now - lastTalk > 45 * 60000) pool.push(...content.TAP_LINES.idle);
    if (hour >= 23 || hour < 5) pool.push(...content.TAP_LINES.night);
    if (hour >= 6 && hour < 10) pool.push(...content.TAP_LINES.morning);
    if (state.mood <= 35) pool.push(...content.TAP_LINES.low, ...content.TAP_LINES.low);
    if (state.mood >= 75) pool.push(...content.TAP_LINES.happy);
    pool.push(...content.TAP_LINES.soft, ...content.TAP_LINES.soft);
    return pick(pool, rng);
  }

  function spamText(combo, content) {
    const dots = "。".repeat(Math.max(1, Math.min(24, combo)));
    const mark = combo >= 7 ? content.SPAM_MARKS[Math.min(content.SPAM_MARKS.length - 1, Math.floor((combo - 7) / 4))] : "";
    return { dots, mark };
  }

  function daysTogether(state, nowMs) {
    const start = Date.parse(state.createdAt || 0);
    if (!start) return 1;
    const now = nowMs || Date.now();
    // Count calendar days, not 24-hour periods: after midnight it becomes day 2
    // even if the account was created less than 24 hours ago.
    return Math.max(1, dayIndex(now) - dayIndex(start) + 1);
  }

  function sevenDay(state, nowMs) {
    const now = nowMs || Date.now();
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = todayKey(d);
      const row = state.daily[key] || { activeSeconds: 0, mood: null };
      out.push({ key, label: `${d.getMonth() + 1}/${d.getDate()}`, activeSeconds: row.activeSeconds || 0, mood: row.mood });
    }
    return out;
  }

  function setBackground(state, content, id, nowMs) {
    const scene = content.SCENES.find((s) => s.id === id);
    if (!scene) return { ok: false, error: "unknown_background" };
    state.background = scene.id;
    state.lastInteractionAt = new Date(nowMs || Date.now()).toISOString();
    state.rev = (state.rev || 0) + 1;
    return { ok: true, background: scene.id, name: scene.name };
  }

  function validateName(name) {
    const s = String(name || "").replace(/[\u0000-\u001f<>]/g, "").trim();
    return s.slice(0, 12);
  }

  return {
    MOOD_MIN,
    MOOD_MAX,
    FULL_REFUSE,
    FULL_SOFT,
    TAP_WINDOW_MS,
    clamp,
    round1,
    todayKey,
    dayIndex,
    pick,
    newState,
    normalize,
    ensureDay,
    currentDaily,
    moodLabel,
    applyTap,
    applyFeed,
    startOuting,
    finishOuting,
    startExercise,
    finishExercise,
    markRecapSeen,
    markExerciseSeen,
    heartbeat,
    tapLine,
    spamText,
    setBackground,
    daysTogether,
    hungerLevel,
    sevenDay,
    validateName,
    findFeed,
    findOuting,
    findExercise
  };
});
