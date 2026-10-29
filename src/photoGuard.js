// photoGuard.js — one shared screening system for every photo upload (resident and officer).
//
// guardUpload(file, src, uploader):
//   - reads the photo's authenticity facts (camera, AI-tool traces, size) before metadata is stripped
//   - with Supabase connected, also asks the server-side AI detection model (detect-ai-image)
//   - real photo  -> { ok: true }   (nothing is shown to the user)
//   - AI-generated -> rejected, a warning is recorded on the account, { ok: false, count, locked }
// After MAX_WARNINGS warnings the account can no longer upload photos until a supervisor clears it.
//
// Warnings are stored in Supabase (table photo_warnings) when connected, otherwise in this browser.
import { CLOUD, getSupabase } from "./supabase";
import { readPhotoSignals, assessPhoto, detectAiOnline, PROVIDER_NAME } from "./imageCheck";
import { detectAi, decide, DETECTOR_NAME } from "./aiDetector";

export const MAX_WARNINGS = 3;
const AI_SCORE_LIMIT = 0.7; // detection model score at or above this counts as AI-generated
const LOCAL_KEY = "civicaccord_photo_warnings_v1";
let memory = null; // fallback when browser storage is blocked

/* ---------------- storage ---------------- */
function loadLocal() {
  try {
    const s = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null");
    if (s && typeof s === "object") return (memory = s);
  } catch { /* storage blocked */ }
  return memory || {};
}
function saveLocal(all) {
  memory = all;
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(all)); } catch { /* memory only */ }
}
/** Lets every screen showing an account's status refresh when warnings change. */
function announce() {
  try { window.dispatchEvent(new Event("photoguard:change")); } catch { /* not in a browser */ }
}

const fromRow = (r) => ({
  userId: r.user_id, userName: r.user_name, role: r.role, reason: r.reason, score: r.score,
  at: new Date(r.created_at).getTime(),
});

async function cloud() {
  if (!CLOUD) return null;
  try { return await getSupabase(); } catch { return null; }
}

/** All warnings recorded for one account, oldest first. */
export async function getWarnings(userId) {
  const sb = await cloud();
  if (sb) {
    const { data, error } = await sb.from("photo_warnings").select("*").eq("user_id", userId).order("created_at", { ascending: true });
    if (!error) return data.map(fromRow);
  }
  return loadLocal()[userId] || [];
}

async function addWarning(uploader, reason, score) {
  const entry = { userId: uploader.id, userName: uploader.name, role: uploader.role, reason, score: score ?? null, at: Date.now() };
  const sb = await cloud();
  if (sb) {
    const { error } = await sb.from("photo_warnings").insert({
      user_id: entry.userId, user_name: entry.userName, role: entry.role, reason: entry.reason, score: entry.score,
    });
    if (!error) { announce(); return getWarnings(uploader.id); }
  }
  const all = loadLocal();
  all[uploader.id] = [...(all[uploader.id] || []), entry];
  saveLocal(all);
  announce();
  return all[uploader.id];
}

/** Accounts with at least one warning, most warnings first (for the supervisor). */
export async function listFlagged() {
  let rows = null;
  const sb = await cloud();
  if (sb) {
    const { data, error } = await sb.from("photo_warnings").select("*").order("created_at", { ascending: true });
    if (!error) rows = data.map(fromRow);
  }
  if (!rows) rows = Object.values(loadLocal()).flat();
  const byUser = {};
  for (const w of rows) {
    const u = (byUser[w.userId] ||= { userId: w.userId, userName: w.userName, role: w.role, count: 0, last: 0, reasons: [] });
    u.count++;
    u.last = Math.max(u.last, w.at);
    u.reasons.push(w.reason);
  }
  return Object.values(byUser).sort((a, b) => b.count - a.count || b.last - a.last);
}

/** Supervisor action: clears an account's warnings and lets it upload again. */
export async function clearWarnings(userId) {
  const sb = await cloud();
  if (sb) {
    const { error } = await sb.rpc("clear_photo_warnings", { p_user: userId });
    if (!error) { announce(); return; }
  }
  const all = loadLocal();
  delete all[userId];
  saveLocal(all);
  announce();
}

/* ---------------- screening ---------------- */
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

/**
 * Decides whether a photo is AI-generated.
 * Primary: our own in-browser model (aiDetector.js) combined with file evidence.
 * Optional second opinion: a server-side detector (Hive / Sightengine) when Supabase is set up.
 */
export async function screenPhoto(file, src) {
  const signals = await readPhotoSignals(file);
  let verdict = decide(signals, null); // AI-tool traces in the file are enough on their own
  if (!verdict) {
    let model;
    try {
      model = await withTimeout(detectAi(file), 30000);
    } catch {
      // never accept a photo unchecked: ask the user to try again instead (no warning given)
      return { isAi: false, unchecked: true, signals };
    }
    verdict = decide(signals, model);
  }
  let online = null;
  if (CLOUD) {
    try { online = await withTimeout(detectAiOnline(src), 10000); } catch { online = null; }
  }
  if (!verdict.isAi && online && online.aiGenerated >= AI_SCORE_LIMIT) {
    verdict = { isAi: true, score: online.aiGenerated, reason: `${PROVIDER_NAME[online.provider] || "AI detector"}: ${Math.round(online.aiGenerated * 100)}% likely AI-generated` };
  }
  return { isAi: verdict.isAi, signals, score: verdict.score, reason: verdict.reason, provider: "civic", detector: DETECTOR_NAME };
}

/**
 * Screens one upload for an account.
 * Returns { ok: true, signals } for a real photo, or { ok: false, count, locked, reason } when rejected.
 */
export async function guardUpload(file, src, uploader, { record = true } = {}) {
  const result = await screenPhoto(file, src);
  if (result.unchecked) return { ok: false, unchecked: true };
  if (!result.isAi || !uploader) return { ok: true, signals: result.signals };
  if (!record) return { ok: false, flagged: result }; // caller records it (officers: in the audit ledger)
  const list = await addWarning(uploader, result.reason, result.score);
  return { ok: false, count: list.length, locked: list.length >= MAX_WARNINGS, reason: result.reason, flagged: result };
}
