// civicLedger.js — shared state machine + hash-chained event ledger for Civic Accord.
// All three persona screens (Citizen / Officer / Supervisor) import this file,
// so the rules live in ONE place and no UI can bypass them.
import { useState, useEffect, useRef, useCallback, useMemo } from "react";

export const HOUR = 60 * 60 * 1000;
export const AUTO_CLOSE_MS = 72 * HOUR;
const STORAGE_KEY = "civicaccord_ledger_v1";
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
};

const VERB = {
  SUBMIT: "submit a complaint",
  PROPOSE: "propose a resolution",
  CONFIRM: "confirm closure",
  DISPUTE: "dispute a resolution",
  AUTO_CLOSE: "auto-close a case",
  ORDER_REWORK: "order rework",
  UPHOLD: "close this case",
};

export const PEOPLE = {
  riya:    { id: "riya",    name: "Riya",    role: "CITIZEN" },
  arjun:   { id: "arjun",   name: "Arjun",   role: "CITIZEN" },
  meena:   { id: "meena",   name: "Meena",   role: "CITIZEN" },
  kabir:   { id: "kabir",   name: "Kabir",   role: "CITIZEN" },
  sana:    { id: "sana",    name: "Sana",    role: "CITIZEN" },
  vikram:  { id: "vikram",  name: "Vikram",  role: "CITIZEN" },
  damodar: { id: "damodar", name: "Officer Damodar",  role: "OFFICER" },
  patel:   { id: "patel",   name: "Supervisor Patel", role: "SUPERVISOR" },
  system:  { id: "system",  name: "System (72h timer)", role: "SYSTEM" },
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
    c.state = ACTIONS[e.type] ? ACTIONS[e.type].to : c.state;
    c.updatedAt = e.at;
    if (e.type === "PROPOSE") { c.proposal = e.data; c.proposedAt = e.at; }
    if (e.type === "DISPUTE") { c.dispute = e.data; c.disputedAt = e.at; }
    if (e.type === "ORDER_REWORK" || e.type === "UPHOLD") {
      c.ruling = { ...e.data, by: e.actorName, at: e.at };
    }
    if (e.type === "AUTO_CLOSE") c.autoClose = e.data;
  }
  return [...byId.values()];
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

async function seal(draft, prev) {
  const body = bodyOf({ ...draft, seq: prev ? prev.seq + 1 : 1, prevHash: prev ? prev.hash : GENESIS });
  return { ...body, hash: await sha256(JSON.stringify(body)) };
}

/** Recomputes every hash and link. Any edited event breaks the chain from that point. */
export async function verifyLedger(events) {
  let prevHash = GENESIS;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const recomputed = await sha256(JSON.stringify(bodyOf(e)));
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
    ev(id, "SUBMIT", who, at, { assignedTo: P.damodar.id, category: "Waste collection", ...data });
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
    ev("1062", "CONFIRM", P.sana, h(96), { note: "Picked up. Thank you." }),

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
  ].sort((a, b) => a.at - b.at);

  const out = [];
  for (const d of drafts) out.push(await seal(d, out[out.length - 1]));
  return out;
}

/* ------------------------------------------------------------------ */
/* 5. React hooks                                                      */
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

  const loadSeed = useCallback(
    () => enqueue(async () => commit(await buildSeed(Date.now()))),
    [enqueue, commit]
  );

  useEffect(() => {
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

  const cases = useMemo(() => (events ? deriveCases(events) : []), [events]);

  const dispatch = useCallback(
    (caseId, action, actor, data = {}) =>
      enqueue(async () => {
        const list = eventsRef.current || [];
        const current = deriveCases(list).find((c) => c.id === caseId) || null;
        const err = checkTransition(current, action, actor.role, actor.id);
        if (err) throw new Error(err);
        const sealed = await seal(
          { caseId, type: action, actorId: actor.id, actorName: actor.name, role: actor.role, at: now, data },
          list[list.length - 1]
        );
        commit([...list, sealed]);
        return sealed;
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
    return loadSeed();
  }, [loadSeed]);

  return { ready: events !== null, events: events || [], cases, dispatch, reset, storageWarning };
}
