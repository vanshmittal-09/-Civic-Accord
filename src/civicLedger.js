// civicLedger.js — shared state machine + hash-chained event ledger for Civic Accord.
// All three persona screens (Citizen / Officer / Supervisor) import this file,
// so the rules live in ONE place and no UI can bypass them.
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { scene } from "./seedArt";
import { CLOUD, getSupabase } from "./supabase";

export const HOUR = 60 * 60 * 1000;
export const AUTO_CLOSE_MS = 72 * HOUR;
const STORAGE_KEY = "civicaccord_ledger_v9"; // v9: AI photo flags
const GENESIS = "0".repeat(64);

// In-memory copy shared by every screen on the page. Used when browser storage is
// blocked (private windows, embedded previews) so signing out and in keeps the data.
let memoryLedger = null;

/* ------------------------------------------------------------------ */
/* 1. Finite state machine                                             */
/* ------------------------------------------------------------------ */
export const STATES = {
  SUBMITTED: "SUBMITTED",
  PROPOSED: "RESOLUTION_PROPOSED",
  CONTESTED: "CONTESTED",
  REWORK: "REWORK_ORDERED",
  CONFIRMED: "CITIZEN_CONFIRMED",
  UNCONTESTED: "UNCONTESTED_CLOSURE",
  REVIEWER_CLOSED: "REVIEWER_CLOSED",
};
export const CLOSED_STATES = [STATES.CONFIRMED, STATES.UNCONTESTED, STATES.REVIEWER_CLOSED];

// action -> which states it may start from, where it goes, and who may trigger it
export const ACTIONS = {
  SUBMIT:       { from: [null],                            to: STATES.SUBMITTED,       roles: ["CITIZEN"] },
  PROPOSE:      { from: [STATES.SUBMITTED, STATES.REWORK], to: STATES.PROPOSED,        roles: ["OFFICER"] },
  CONFIRM:      { from: [STATES.PROPOSED],                 to: STATES.CONFIRMED,       roles: ["CITIZEN"] },
  DISPUTE:      { from: [STATES.PROPOSED],                 to: STATES.CONTESTED,       roles: ["CITIZEN"] },
  AUTO_CLOSE:   { from: [STATES.PROPOSED],                 to: STATES.UNCONTESTED,     roles: ["SYSTEM"] },
  ORDER_REWORK: { from: [STATES.CONTESTED],                to: STATES.REWORK,          roles: ["SUPERVISOR"] },
  UPHOLD:       { from: [STATES.CONTESTED],                to: STATES.REVIEWER_CLOSED, roles: ["SUPERVISOR"] },
  // a resident can rate a closed case once (state doesn't change)
  RATE:         { from: CLOSED_STATES,                     to: null,                   roles: ["CITIZEN"] },
  // supervisor's formal warning to the officer: incomplete work or a tampered/fake photo (state doesn't change)
  WARN_OFFICER: { from: [STATES.CONTESTED],                to: null,                   roles: ["SUPERVISOR"] },
  // the AI detector rejected an officer's work-completion photo: counts as a tampered-image warning
  AI_FLAG:      { from: [STATES.SUBMITTED, STATES.REWORK, STATES.PROPOSED, STATES.CONTESTED], to: null, roles: ["SYSTEM"] },
  // supervisor lifts an officer's suspension early (not tied to a case; caseId is "officer-<id>")
  REINSTATE_OFFICER: { from: [null],                       to: null,                   roles: ["SUPERVISOR"] },
};

const VERB = {
  SUBMIT: "submit a complaint",
  PROPOSE: "propose a resolution",
  CONFIRM: "confirm closure",
  DISPUTE: "dispute a resolution",
  AUTO_CLOSE: "auto-close a case",
  ORDER_REWORK: "order rework",
  UPHOLD: "close this case",
  RATE: "rate this resolution",
  WARN_OFFICER: "warn the officer",
  REINSTATE_OFFICER: "reinstate an officer",
  AI_FLAG: "flag an AI-generated photo",
};

export const PEOPLE = {
  riya:    { id: "riya",    name: "Riya",    role: "CITIZEN" },
  arjun:   { id: "arjun",   name: "Arjun",   role: "CITIZEN" },
  meena:   { id: "meena",   name: "Meena",   role: "CITIZEN" },
  kabir:   { id: "kabir",   name: "Kabir",   role: "CITIZEN" },
  sana:    { id: "sana",    name: "Sana",    role: "CITIZEN" },
  vikram:  { id: "vikram",  name: "Vikram",  role: "CITIZEN" },
  farah:   { id: "farah",   name: "Farah",   role: "CITIZEN" },
  anil:    { id: "anil",    name: "Anil",    role: "CITIZEN" },
  imran:   { id: "imran",   name: "Imran",   role: "CITIZEN" },
  damodar: { id: "damodar", name: "Officer Damodar",  role: "OFFICER" },
  patel:   { id: "patel",   name: "Supervisor Patel", role: "SUPERVISOR" },
  system:  { id: "system",  name: "System (72h timer)", role: "SYSTEM" },
  aicheck: { id: "aicheck", name: "Hive AI Detector", role: "SYSTEM" },
};

/** Returns null if allowed, otherwise a human-readable reason. */
export function checkTransition(caseObj, action, role, actorId) {
  const rule = ACTIONS[action];
  if (!rule) return `Unknown action "${action}".`;
  if (!rule.roles.includes(role)) {
    return `Blocked by state machine: ${role.toLowerCase()} cannot ${VERB[action]}. Only ${rule.roles
      .map((r) => r.toLowerCase())
      .join(" / ")} can.`;
  }
  const state = caseObj ? caseObj.state : null;
  if (!rule.from.includes(state)) {
    return `Blocked by state machine: cannot ${VERB[action]} while the case is ${state}.`;
  }
  if (role === "OFFICER" && caseObj && caseObj.assignedTo !== actorId) {
    return "Blocked: this case is assigned to another officer.";
  }
  if (role === "CITIZEN" && caseObj && caseObj.citizenId !== actorId) {
    return "Blocked: only the citizen who filed this case can respond to it.";
  }
  if (action === "RATE" && caseObj && caseObj.rating) {
    return "You've already rated this resolution.";
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 2. Event sourcing: current state = replay of the ledger             */
/* ------------------------------------------------------------------ */
export function deriveCases(events) {
  const byId = new Map();
  for (const e of events) {
    let c = byId.get(e.caseId);
    if (e.type === "SUBMIT") {
      c = {
        id: e.caseId,
        ...e.data,
        citizenId: e.actorId,
        citizenName: e.actorName,
        submittedAt: e.at,
        events: [],
      };
      byId.set(e.caseId, c);
    }
    if (!c) continue;
    c.events.push(e);
    if (ACTIONS[e.type] && ACTIONS[e.type].to) c.state = ACTIONS[e.type].to;
    if (e.type === "CONFIRM" || e.type === "AUTO_CLOSE" || e.type === "UPHOLD") c.closedAt = e.at;
    if ((e.type === "CONFIRM" || e.type === "RATE") && e.data && e.data.rating) {
      c.rating = { stars: e.data.rating, comment: e.data.comment || "", at: e.at };
    }
    c.updatedAt = e.at;
    if (e.type === "PROPOSE") { c.proposal = e.data; c.proposedAt = e.at; }
    if (e.type === "DISPUTE") { c.dispute = e.data; c.disputedAt = e.at; }
    if (e.type === "ORDER_REWORK" || e.type === "UPHOLD") {
      c.ruling = { ...e.data, by: e.actorName, at: e.at };
    }
    if (e.type === "AUTO_CLOSE") c.autoClose = e.data;
    if (e.type === "ORDER_REWORK") c.reworkCount = (c.reworkCount || 0) + 1;
    if (e.type === "WARN_OFFICER") c.warnings = [...(c.warnings || []), { ...e.data, at: e.at, by: e.actorName }];
    if (e.type === "AI_FLAG") c.aiFlags = [...(c.aiFlags || []), { ...e.data, at: e.at, by: e.actorName }];
  }
  return [...byId.values()];
}

/* Officer warnings: up to 3 in any 7 days. A warning beyond 3 suspends the officer for 7 days. */
export const MAX_OFFICER_WARNINGS = 3;
export const WARNING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const SUSPENSION_MS = WARNING_WINDOW_MS;
export const WARNING_KINDS = {
  INCOMPLETE: { label: "Incomplete work", short: "Incomplete" },
  TAMPERED: { label: "Image tampered / fake photo", short: "Tampered image" },
  POOR_REWORK: { label: "Incomplete work", short: "Incomplete" }, // older records
};

/**
 * An officer's warning record.
 *  all        - every warning, newest first
 *  thisWeek   - warnings in the last 7 days (since any reinstatement)
 *  suspended  - { at, until, reason } while a suspension is in force, else null
 */
export function officerWarnings(events, officerId, now) {
  let reinstatedAt = 0;
  for (const e of events) {
    if (e.type === "REINSTATE_OFFICER" && e.data && e.data.officerId === officerId) reinstatedAt = Math.max(reinstatedAt, e.at);
  }
  const all = events
    .filter((e) => (e.type === "WARN_OFFICER" || e.type === "AI_FLAG") && e.data && e.data.officerId === officerId)
    .map((e) => ({ ...e.data, kind: e.data.kind in WARNING_KINDS ? e.data.kind : "INCOMPLETE", caseId: e.caseId, at: e.at, by: e.actorName, auto: e.type === "AI_FLAG" }))
    .sort((a, b) => b.at - a.at);
  const thisWeek = all.filter((w) => now - w.at < WARNING_WINDOW_MS && w.at > reinstatedAt);
  const s = all.find((w) => w.suspends && w.at > reinstatedAt && now - w.at < SUSPENSION_MS);
  const suspended = s ? { at: s.at, until: s.at + SUSPENSION_MS, reason: s.reason, by: s.by } : null;
  return { all, thisWeek, suspended, reinstatedAt, escalated: !!suspended, full: thisWeek.length >= MAX_OFFICER_WARNINGS };
}

/** Rules that depend on the officer's record rather than one case. Returns [error, data]. */
function officerRules(list, action, actor, data, now) {
  if (action === "PROPOSE") {
    const w = officerWarnings(list, actor.id, now);
    if (w.suspended) return [`You are suspended until ${new Date(w.suspended.until).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} after exceeding ${MAX_OFFICER_WARNINGS} warnings in a week. You can't submit resolutions until then or until a supervisor reinstates you.`];
  }
  if (action === "WARN_OFFICER") {
    if (!data || !(data.kind in WARNING_KINDS) || data.kind === "POOR_REWORK") return ["Choose the warning type: incomplete work or tampered image."];
    if (!data.reason || data.reason.trim().length < 15) return ["Give a reason for the warning (at least 15 characters)."];
    const w = officerWarnings(list, data.officerId, now);
    if (w.suspended) return [`${data.officerName || "This officer"} is already suspended.`];
    return [null, { ...data, suspends: w.thisWeek.length >= MAX_OFFICER_WARNINGS }];
  }
  if (action === "AI_FLAG") {
    const w = officerWarnings(list, data.officerId, now);
    return [null, { ...data, kind: "TAMPERED", suspends: !w.suspended && w.thisWeek.length >= MAX_OFFICER_WARNINGS }];
  }
  if (action === "REINSTATE_OFFICER") {
    if (!officerWarnings(list, data && data.officerId, now).suspended) return ["This officer isn't suspended."];
  }
  return [null, data];
}

/* ------------------------------------------------------------------ */
/* 3. Hash chain (tamper-evident, not tamper-proof)                    */
/* ------------------------------------------------------------------ */
async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// fixed field order so the hash is reproducible
function bodyOf(e) {
  return {
    seq: e.seq, caseId: e.caseId, type: e.type, actorId: e.actorId, actorName: e.actorName,
    role: e.role, at: e.at, data: e.data, prevHash: e.prevHash,
  };
}

// Stable JSON: keys sorted at every level, so the fingerprint is the same
// no matter how a database stores or returns the fields.
export function canonicalJSON(v) {
  if (Array.isArray(v)) return `[${v.map((x) => canonicalJSON(x === undefined ? null : x)).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJSON(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
}

async function seal(draft, prev) {
  const body = bodyOf({ ...draft, seq: prev ? prev.seq + 1 : 1, prevHash: prev ? prev.hash : GENESIS });
  return { ...body, hash: await sha256(canonicalJSON(body)) };
}

/** Recomputes every hash and link. Any edited event breaks the chain from that point. */
export async function verifyLedger(events) {
  let prevHash = GENESIS;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const recomputed = await sha256(canonicalJSON(bodyOf(e)));
    if (e.seq !== i + 1 || e.prevHash !== prevHash || recomputed !== e.hash) {
      return { ok: false, count: events.length, brokenAt: i + 1 };
    }
    prevHash = e.hash;
  }
  return { ok: true, count: events.length };
}

/* ------------------------------------------------------------------ */
/* 4. Synthetic seed data (Case #1084 + supporting cases)              */
/* ------------------------------------------------------------------ */
export async function buildSeed(now) {
  const h = (n) => now - n * HOUR;
  const P = PEOPLE;
  const ev = (caseId, type, who, at, data = {}) => ({
    caseId, type, actorId: who.id, actorName: who.name, role: who.role, at, data,
  });
  const submit = (id, who, at, data) =>
    ev(id, "SUBMIT", who, at, { assignedTo: P.damodar.id, category: "Garbage & sanitation", ...data });
  const proof = (note, checklist, photoLabel, capturedAt) => ({
    note, checklist, photo: null, photoLabel, capturedAt, metadataStripped: true,
  });

  const drafts = [
    submit("1084", P.riya, h(3), {
      title: "Missed collection — overflowing bin",
      location: "Sector 14 Park, near Gate 2",
      description: "The community bin hasn't been emptied for three days. Waste is spilling onto the walking path.",
      photoLabel: "Overflowing bin at park gate",
    }),

    submit("1091", P.arjun, h(50), {
      title: "Garbage piled at bus stop",
      location: "Sector 15 Market, bus stop",
      description: "Both roadside bins are full and bags are piled next to the shelter.",
      photoLabel: "Bags piled at bus shelter",
    }),
    ev("1091", "PROPOSE", P.damodar, h(20), proof(
      "Emptied both roadside bins and cleared the bags next to the shelter. Waste loaded into vehicle HR-51-4471.",
      ["container", "area"], "Cleared bus stop bins", h(20.2))),

    submit("1077", P.meena, h(100), {
      title: "Overflowing community bin",
      location: "Sector 16, Block C",
      description: "Bin overflowing and stray dogs scattering the waste across the lane.",
      photoLabel: "Overflowing bin, Block C",
    }),
    ev("1077", "PROPOSE", P.damodar, h(80), proof(
      "Container emptied during the morning round at 7:40 AM.",
      ["container"], "Empty bin, Block C", h(80.3))),
    ev("1077", "DISPUTE", P.meena, h(62), {
      note: "The bin is empty but the loose waste scattered around it was not picked up.",
      photo: null, photoLabel: "Loose waste beside the bin",
    }),

    submit("1069", P.kabir, h(150), {
      title: "Construction debris on footpath",
      location: "Sector 14, Lane 3",
      description: "A pile of broken tiles and cement bags is blocking the footpath.",
      photoLabel: "Debris pile on footpath",
    }),
    ev("1069", "PROPOSE", P.damodar, h(130), proof(
      "Cleared the bin at the lane corner.", ["container"], "Lane 3 corner bin", h(130.1))),
    ev("1069", "DISPUTE", P.kabir, h(120), {
      note: "The debris on the footpath is still there. Only the corner bin was emptied.",
      photo: null, photoLabel: "Debris still on footpath",
    }),
    ev("1069", "ORDER_REWORK", P.patel, h(20), {
      outcome: "OVERTURNED",
      ruling: "The officer's photo shows the corner bin, not the footpath. The citizen's photo shows the debris pile still in place. Clear the debris and submit fresh proof of the footpath.",
    }),

    submit("1062", P.sana, h(120), {
      title: "Missed door-to-door pickup",
      location: "Sector 17, House 212 lane",
      description: "Collection vehicle skipped our lane two days in a row.",
      photoLabel: "Bags waiting at gate",
    }),
    ev("1062", "PROPOSE", P.damodar, h(100), proof(
      "Lane covered on the evening round. Vehicle route updated to include this lane.",
      ["container", "area"], "Lane after pickup", h(100.2))),
    ev("1062", "CONFIRM", P.sana, h(96), { note: "Picked up. Thank you.", rating: 4, comment: "Picked up the next evening. Would be 5 stars if it was the same day." }),

    submit("1055", P.vikram, h(200), {
      title: "Bin lid broken, waste exposed",
      location: "Sector 15, Community Centre",
      description: "The lid is broken and crows are pulling waste out.",
      photoLabel: "Broken bin lid",
    }),
    ev("1055", "PROPOSE", P.damodar, h(180), proof(
      "Bin emptied and replaced with a new lidded container.",
      ["container", "bulk"], "New lidded bin", h(180.1))),
    ev("1055", "AUTO_CLOSE", P.system, h(108), {
      reason: "No citizen response within 72 hours", windowEndedAt: h(108),
    }),

    submit("1036", P.riya, h(80), {
      title: "Street not swept",
      category: "Garbage & sanitation",
      location: "Sector 14, Market Road",
      description: "The market road hasn't been swept for a week. Plastic and paper are piling up along the shops.",
      photoLabel: "Litter along market road",
    }),
    ev("1036", "PROPOSE", P.damodar, h(40), proof(
      "Swept the full market road stretch and cleared the litter along the shop fronts. Added the road to the daily sweeping route.",
      ["area", "transported"], "Market road swept", h(40.2))),
    ev("1036", "CONFIRM", P.riya, h(30), { note: "Road is clean now.", rating: 5, comment: "Very quick. The road is spotless and now gets swept every morning." }),

    // a case where the rework was done badly: disputed again after rework
    submit("1027", P.imran, h(140), {
      title: "Garbage dumped in lane",
      category: "Garbage & sanitation",
      location: "Sector 16, Lane 9 (behind the dairy)",
      description: "Bags of household waste are dumped at the end of the lane every night and are now blocking the drain.",
      photoLabel: "Bags dumped at lane end",
    }),
    ev("1027", "PROPOSE", P.damodar, h(120), proof(
      "Lifted the bags from the lane.", ["container"], "Lane end", h(120.2))),
    ev("1027", "DISPUTE", P.imran, h(110), {
      note: "Only a few bags were taken. Most of the waste and the blocked drain are still there.",
      photo: null, photoLabel: "Waste still in lane",
    }),
    ev("1027", "ORDER_REWORK", P.patel, h(100), {
      outcome: "OVERTURNED",
      ruling: "The resident's photo shows most of the waste still in the lane and the drain blocked. Clear all the waste, open the drain and submit photos of the whole lane.",
    }),
    ev("1027", "PROPOSE", P.damodar, h(60), proof(
      "Cleared the lane again.", ["area"], "Lane after rework", h(60.3))),
    ev("1027", "DISPUTE", P.imran, h(40), {
      note: "Same as last time. The drain is still blocked and bags were left behind the dairy wall.",
      photo: null, photoLabel: "Drain still blocked",
    }),

    submit("1048", P.farah, h(170), {
      title: "Garbage dumped in open area",
      category: "Garbage & sanitation",
      location: "Sector 17, open plot near community park",
      description: "People have been dumping household garbage on the empty plot for weeks. It smells and attracts stray dogs.",
      photoLabel: "Garbage dumped on open plot",
    }),
    ev("1048", "PROPOSE", P.damodar, h(158), proof(
      "Cleared about 2 tonnes of dumped waste with a JCB and tipper. Put up a No Dumping board with fine details.",
      ["bulk", "area", "transported"], "Plot cleared, board installed", h(158.2))),
    ev("1048", "CONFIRM", P.farah, h(150), { note: "Plot is clean now. Thank you for the board.", rating: 5, comment: "Plot is clean now and the No Dumping board really helps." }),

    submit("1041", P.anil, h(230), {
      title: "Blocked or overflowing drain",
      category: "Drains & water",
      location: "Sector 15, Lane 6",
      description: "The roadside drain is choked with plastic and the water overflows onto the lane every evening.",
      photoLabel: "Choked roadside drain",
    }),
    ev("1041", "PROPOSE", P.damodar, h(214), proof(
      "Desilted and cleared 40 metres of drain, removed plastic and silt, and fixed two loose grates.",
      ["drain", "area", "transported"], "Drain cleared and flowing", h(214.3))),
    ev("1041", "DISPUTE", P.anil, h(212), {
      note: "Water is still standing at the far end of the lane.",
      photo: null, photoLabel: "Water at far end",
    }),
    ev("1041", "RATE", P.anil, h(190), { rating: 3, comment: "Drain is fine now, but it needed a dispute to get a proper answer." }),
    ev("1041", "UPHOLD", P.patel, h(205), {
      outcome: "UPHELD",
      ruling: "The officer's photos cover the full 40 m stretch and show the drain flowing. The resident's photo matches the state before the work finished. Resolution upheld and case closed.",
      bulkTruckDispatched: false,
    }),
  ];

  // attach drawn illustrations (synthetic demo data, not real photos)
  const ART = {
    SUBMIT:  { 1027: "laneDump", 1036: "litteredStreet", 1048: "openDump", 1041: "drainBlocked", 1084: "overflowPark", 1091: "busBags", 1077: "blockOverflow", 1069: "debrisFootpath", 1062: "gateBags", 1055: "brokenLid" },
    PROPOSE: { 1027: "laneClean", 1036: "sweptStreet", 1048: "openClean", 1041: "drainClear", 1091: "busClean", 1077: "blockEmptyBin", 1069: "cornerBin", 1062: "laneClean", 1055: "newBin" },
    DISPUTE: { 1027: "laneDump", 1041: "drainBlocked", 1077: "blockLooseWaste", 1069: "debrisStill" },
  };
  for (const d of drafts) {
    const name = ART[d.type] && ART[d.type][d.caseId];
    if (name) d.data = { ...d.data, photos: [{ src: scene(name), capturedAt: d.data.capturedAt || d.at, sample: true }] };
  }
  drafts.sort((a, b) => a.at - b.at);

  const out = [];
  for (const d of drafts) out.push(await seal(d, out[out.length - 1]));
  return out;
}

/* ------------------------------------------------------------------ */
/* 5. Online database (Supabase) helpers                               */
/* ------------------------------------------------------------------ */
export const toRow = (e) => ({
  seq: e.seq, case_id: e.caseId, type: e.type, actor_id: e.actorId, actor_name: e.actorName,
  role: e.role, at: e.at, data: e.data, prev_hash: e.prevHash, hash: e.hash,
});
export const fromRow = (r) => ({
  seq: Number(r.seq), caseId: r.case_id, type: r.type, actorId: r.actor_id, actorName: r.actor_name,
  role: r.role, at: Number(r.at), data: r.data || {}, prevHash: r.prev_hash, hash: r.hash,
});

// Gives up on a database call that takes too long (no internet, wrong address).
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("Timed out"), { code: "TIMEOUT" })), ms)),
  ]);
}

function dbError(error) {
  const e = new Error(error.message || "Database error");
  e.code = error.code;
  return e;
}

/** Loads the whole ledger in order. */
export async function cloudLoad(sb) {
  const { data, error } = await sb.from("events").select("*").order("seq", { ascending: true }).limit(10000);
  if (error) throw dbError(error);
  return data.map(fromRow);
}

/** Loads the ledger, creating the synthetic demo cases if it's empty. */
export async function cloudSeedIfEmpty(sb) {
  const list = await cloudLoad(sb);
  if (list.length) return list;
  const seed = await buildSeed(Date.now());
  const { error } = await sb.from("events").insert(seed.map(toRow));
  if (error && error.code !== "23505") throw dbError(error); // 23505: another device seeded first
  return cloudLoad(sb);
}

/** Appends one sealed entry. Throws with code 23505 if another device added one first. */
export async function cloudAppend(sb, sealed) {
  const { error } = await sb.from("events").insert(toRow(sealed));
  if (error) throw dbError(error);
}

/* ------------------------------------------------------------------ */
/* 6. React hooks                                                      */
/* ------------------------------------------------------------------ */

/** Live clock: re-renders every 15s so countdowns stay current. */
export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** The ledger: load / seed / append (serialized) / auto-close / reset. */
export function useCivicLedger(now) {
  const [events, setEvents] = useState(null);
  const [storageWarning, setStorageWarning] = useState("");
  const [cloudWarning, setCloudWarning] = useState("");
  const eventsRef = useRef(null);
  const queueRef = useRef(Promise.resolve());

  const commit = useCallback((list) => {
    eventsRef.current = list;
    memoryLedger = list;
    setEvents(list);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      setStorageWarning("");
    } catch {
      setStorageWarning("Browser storage is blocked here, so data is kept in memory and resets if you reload the page.");
    }
  }, []);

  // every write goes through one queue so two clicks can never fork the chain
  const enqueue = useCallback((fn) => {
    const p = queueRef.current.then(fn);
    queueRef.current = p.catch(() => {});
    return p;
  }, []);

  const cloudRef = useRef(null); // Supabase client when the online database is in use

  const loadSeed = useCallback(
    () => enqueue(async () => commit(await buildSeed(Date.now()))),
    [enqueue, commit]
  );

  const loadLocal = useCallback(() => {
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { stored = null; }
    if (!(Array.isArray(stored) && stored.length) && memoryLedger && memoryLedger.length) stored = memoryLedger;
    if (Array.isArray(stored) && stored.length) {
      memoryLedger = stored;
      eventsRef.current = stored;
      setEvents(stored);
    } else {
      loadSeed();
    }
  }, [loadSeed]);

  useEffect(() => {
    if (!CLOUD) { loadLocal(); return undefined; }

    let cancelled = false;
    let channel = null;
    let sbRef = null;
    (async () => {
      try {
        const sb = await getSupabase();
        sbRef = sb;
        const list = await enqueue(() => withTimeout(cloudSeedIfEmpty(sb), 8000));
        if (cancelled) return;
        cloudRef.current = sb;
        commit(list);
        // live updates: entries added on any other device appear here straight away
        channel = sb
          .channel("civicaccord-events")
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "events" }, (payload) => {
            const e = fromRow(payload.new);
            const cur = eventsRef.current || [];
            const last = cur[cur.length - 1];
            if (cur[e.seq - 1] && cur[e.seq - 1].hash === e.hash) return; // already have it
            if (e.seq === (last ? last.seq : 0) + 1 && e.prevHash === (last ? last.hash : GENESIS)) {
              commit([...cur, e]);
            } else {
              enqueue(async () => commit(await cloudLoad(sb))); // out of step (e.g. a reset): reload
            }
          })
          .subscribe();
      } catch {
        if (cancelled) return;
        cloudRef.current = null;
        loadLocal();
        setCloudWarning("Couldn't reach the online database, so this device is using its own copy for now. Reload the page to try again.");
      }
    })();
    return () => {
      cancelled = true;
      if (channel && sbRef) sbRef.removeChannel(channel);
    };
  }, [enqueue, commit, loadLocal]);

  const cases = useMemo(() => (events ? deriveCases(events) : []), [events]);

  const dispatch = useCallback(
    (caseId, action, actor, data = {}) =>
      enqueue(async () => {
        for (let attempt = 0; ; attempt++) {
          const list = eventsRef.current || [];
          const current = deriveCases(list).find((c) => c.id === caseId) || null;
          const err = checkTransition(current, action, actor.role, actor.id);
          if (err) throw new Error(err);
          const [ruleErr, checked] = officerRules(list, action, actor, data, Date.now());
          if (ruleErr) throw new Error(ruleErr);
          const sealed = await seal(
            { caseId, type: action, actorId: actor.id, actorName: actor.name, role: actor.role, at: now, data: checked },
            list[list.length - 1]
          );
          const sb = cloudRef.current;
          if (sb) {
            try {
              await withTimeout(cloudAppend(sb, sealed), 10000);
            } catch (e) {
              if (e.code === "23505" && attempt < 2) {
                commit(await withTimeout(cloudLoad(sb), 10000)); // someone else saved first: refresh and re-check
                continue;
              }
              throw new Error("Couldn't save to the online database. Check your internet connection and try again.");
            }
          }
          const latest = eventsRef.current || [];
          if (!(latest[sealed.seq - 1] && latest[sealed.seq - 1].hash === sealed.hash)) {
            commit([...list, sealed]);
          }
          return sealed;
        }
      }),
    [enqueue, commit, now]
  );

  // 72-hour timer engine: computed from timestamps, so it survives refreshes
  useEffect(() => {
    for (const c of cases) {
      if (c.state === STATES.PROPOSED && now - c.proposedAt >= AUTO_CLOSE_MS) {
        dispatch(c.id, "AUTO_CLOSE", PEOPLE.system, {
          reason: "No citizen response within 72 hours",
          windowEndedAt: c.proposedAt + AUTO_CLOSE_MS,
        }).catch(() => {}); // a duplicate attempt is rejected by the FSM
      }
    }
  }, [cases, now, dispatch]);

  const reset = useCallback(() => {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    memoryLedger = null;
    const sb = cloudRef.current;
    if (sb) {
      return enqueue(async () => {
        const { error } = await sb.rpc("reset_demo");
        if (error) throw dbError(error);
        commit(await cloudSeedIfEmpty(sb));
      });
    }
    return loadSeed();
  }, [enqueue, commit, loadSeed]);

  return {
    ready: events !== null, events: events || [], cases, dispatch, reset,
    storageWarning: cloudWarning || storageWarning, online: CLOUD && !cloudWarning,
  };
}
