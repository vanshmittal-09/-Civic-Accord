// shared.jsx — UI building blocks used by all three persona screens.
import { useState } from "react";
import { STATES, AUTO_CLOSE_MS, HOUR } from "./civicLedger";

export const MAX_PHOTOS = 4;
export const MAX_PHOTO_AGE_MS = 24 * HOUR;

/* ---------------- helpers ---------------- */
export const STATUS_META = {
  [STATES.SUBMITTED]:       { label: "Submitted",            cls: "bg-sky-100 text-sky-800 ring-sky-200" },
  [STATES.PROPOSED]:        { label: "Resolution proposed",  cls: "bg-amber-100 text-amber-900 ring-amber-200" },
  [STATES.CONTESTED]:       { label: "Contested",            cls: "bg-rose-100 text-rose-800 ring-rose-200" },
  [STATES.REWORK]:          { label: "Rework ordered",       cls: "bg-violet-100 text-violet-800 ring-violet-200" },
  [STATES.CONFIRMED]:       { label: "Closed · Confirmed",   cls: "bg-emerald-100 text-emerald-800 ring-emerald-200" },
  [STATES.UNCONTESTED]:     { label: "Closed · Uncontested", cls: "bg-emerald-100 text-emerald-800 ring-emerald-200" },
  [STATES.REVIEWER_CLOSED]: { label: "Closed · Reviewer",    cls: "bg-emerald-100 text-emerald-800 ring-emerald-200" },
};

export const EVENT_LABEL = {
  SUBMIT: "Complaint submitted",
  PROPOSE: "Resolution proposed",
  CONFIRM: "Citizen confirmed closure",
  DISPUTE: "Citizen disputed the resolution",
  AUTO_CLOSE: "Auto-closed: no response in 72h",
  ORDER_REWORK: "Supervisor ordered rework",
  UPHOLD: "Supervisor upheld the resolution",
};

export const CHECKS = [
  { key: "container", label: "Container emptied" },
  { key: "area", label: "Surrounding area swept" },
  { key: "bulk", label: "Bulk / extra waste removed" },
  { key: "debris", label: "Construction debris cleared" },
  { key: "segregated", label: "Waste segregated (wet / dry)" },
  { key: "drain", label: "Drain / gutter cleared" },
  { key: "disinfected", label: "Area disinfected / sprayed" },
  { key: "bin_repair", label: "Bin repaired / replaced" },
  { key: "transported", label: "Waste taken to depot" },
  { key: "followup", label: "Follow-up needed (other team)" },
];
export const CHECK_LABEL = Object.fromEntries(CHECKS.map((c) => [c.key, c.label]));

export function dur(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${mm}m`;
  return `${mm}m`;
}
export const ago = (at, now) => `${dur(now - at)} ago`;
export const stamp = (at) =>
  new Date(at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function queueMeta(c, now) {
  switch (c.state) {
    case STATES.SUBMITTED: return `Filed ${ago(c.submittedAt, now)}`;
    case STATES.REWORK: return `Rework ordered ${ago(c.ruling.at, now)}`;
    case STATES.PROPOSED: return `Auto-closes in ${dur(c.proposedAt + AUTO_CLOSE_MS - now)}`;
    case STATES.CONTESTED: return `Disputed ${ago(c.disputedAt, now)}`;
    default: return `Closed ${ago(c.updatedAt, now)}`;
  }
}

/** Redrawing onto a canvas drops ALL metadata (EXIF, GPS, device). Also shrinks the file. */
export function stripAndCompress(file, max = 800) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * s);
      cv.height = Math.round(img.height * s);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode")); };
    img.src = url;
  });
}

/* ---------------- small UI pieces ---------------- */
export function StatusBadge({ state, label }) {
  const m = STATUS_META[state] || { label: state, cls: "bg-slate-100 text-slate-700 ring-slate-200" };
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${m.cls}`}>
      {label || m.label}
    </span>
  );
}

export const Icon = {
  camera: (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12l5 5L20 7" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  ),
};

export function PhotoBox({ src, label, tone = "officer" }) {
  if (src) {
    return <img src={src} alt={label || "Evidence photo"} className="aspect-[4/3] w-full rounded-xl object-cover ring-1 ring-slate-200" />;
  }
  const bg = tone === "citizen" ? "from-rose-50 to-orange-100 text-rose-700" : "from-teal-50 to-emerald-100 text-teal-800";
  return (
    <div className={`flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-xl bg-gradient-to-br ${bg} p-3 text-center ring-1 ring-black/5`}>
      {Icon.camera}
      <span className="text-xs font-medium">{label || "Photo"}</span>
      <span className="text-[10px] uppercase tracking-wide opacity-60">Synthetic sample</span>
    </div>
  );
}

export function Chip({ children, tone = "slate" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-100 text-emerald-800",
    teal: "bg-teal-100 text-teal-800",
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Card({ className = "", children }) {
  return <section className={`rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 ${className}`}>{children}</section>;
}

export function ProofCard({ title, proof, at, tone = "officer" }) {
  if (!proof) return null;
  return (
    <Card>
      <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
      {at && <p className="text-xs text-slate-500">{stamp(at)}</p>}
      {proof.photos && proof.photos.length > 0 ? (
        <div className={`mt-3 grid gap-2 ${proof.photos.length > 1 ? "max-w-md grid-cols-2" : "max-w-sm"}`}>
          {proof.photos.map((ph, i) => (
            <img key={i} src={ph.src} alt={`${title} ${i + 1}`} className="aspect-[4/3] w-full rounded-xl object-cover ring-1 ring-slate-200" />
          ))}
        </div>
      ) : (
        <div className="mt-3 max-w-sm"><PhotoBox src={proof.photo} label={proof.photoLabel} tone={tone} /></div>
      )}
      {proof.checklist?.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {proof.checklist.map((k) => <Chip key={k} tone="teal">{Icon.check}{CHECK_LABEL[k] || k}</Chip>)}
        </div>
      )}
      {proof.note && <p className="mt-3 text-sm leading-relaxed text-slate-700">{proof.note}</p>}
      {proof.metadataStripped && (
        <p className="mt-2 text-xs text-slate-500">Photo metadata (EXIF/GPS) removed before saving.</p>
      )}
    </Card>
  );
}


export function Timeline({ c }) {
  return (
    <Card>
      <h3 className="text-sm font-semibold text-slate-900">Case history</h3>
      <p className="text-xs text-slate-500">Append-only. Each entry is sealed with the hash of the one before it.</p>
      <ol className="mt-4 space-y-4">
        {c.events.map((e, i) => (
          <li key={e.hash} className="relative pl-6">
            {i < c.events.length - 1 && <span className="absolute left-[5px] top-4 h-[calc(100%+0.5rem)] w-px bg-slate-200" />}
            <span className="absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full bg-teal-600 ring-4 ring-teal-100" />
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-sm font-medium text-slate-900">{EVENT_LABEL[e.type] || e.type}</p>
              <p className="font-mono text-[11px] text-slate-400">#{e.seq} · {e.hash.slice(0, 10)}</p>
            </div>
            <p className="text-xs text-slate-500">{e.actorName} · {stamp(e.at)}</p>
          </li>
        ))}
      </ol>
    </Card>
  );
}


/** The citizen's original complaint photos (or a placeholder for synthetic cases). */
export function ComplaintPhotos({ c }) {
  if (c.photos && c.photos.length) {
    return (
      <div className={`grid gap-2 ${c.photos.length > 1 ? "grid-cols-2" : ""}`}>
        {c.photos.map((ph, i) => (
          <img key={i} src={ph.src} alt={`Complaint photo ${i + 1}`} className="aspect-[4/3] w-full rounded-xl object-cover ring-1 ring-slate-200" />
        ))}
      </div>
    );
  }
  return <PhotoBox label={c.photoLabel} tone="citizen" />;
}

/** Multi-photo picker: camera on phones, 24h freshness check, metadata stripped. */
export function PhotoPicker({ photos, onChange, max = MAX_PHOTOS, prompt = "Take photos", hint = "Photos older than 24h are rejected.", tone = "teal" }) {
  const [err, setErr] = useState("");
  const tones = {
    teal: "border-teal-300 bg-teal-50/60 text-teal-800 hover:bg-teal-50 focus-within:ring-teal-500",
    violet: "border-violet-300 bg-violet-50/60 text-violet-800 hover:bg-violet-50 focus-within:ring-violet-500",
    rose: "border-rose-300 bg-rose-50/60 text-rose-800 hover:bg-rose-50 focus-within:ring-rose-500",
  };
  async function onFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    const room = max - photos.length;
    const errors = [];
    const added = [];
    for (const f of files) {
      if (added.length >= room) { errors.push(`Only ${max} photos allowed.`); break; }
      if (!f.type.startsWith("image/")) { errors.push(`${f.name} isn't an image.`); continue; }
      if (Date.now() - f.lastModified > MAX_PHOTO_AGE_MS) { errors.push(`${f.name} is more than 24 hours old.`); continue; }
      try {
        const src = await stripAndCompress(f);
        added.push({ id: `${f.name}-${f.lastModified}-${Math.random().toString(36).slice(2, 7)}`, src, capturedAt: f.lastModified });
      } catch {
        errors.push(`Couldn't read ${f.name}.`);
      }
    }
    onChange([...photos, ...added].slice(0, max));
    setErr(errors.join(" "));
  }
  const input = <input type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={onFiles} />;
  return (
    <div>
      {photos.length === 0 ? (
        <label className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-7 text-center transition focus-within:ring-2 ${tones[tone]}`}>
          {Icon.camera}
          <span className="font-semibold">{prompt}</span>
          <span className="text-xs opacity-80">{hint}</span>
          {input}
        </label>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.map((ph, i) => (
              <figure key={ph.id} className="relative">
                <img src={ph.src} alt={`Photo ${i + 1}`} className="aspect-[4/3] w-full rounded-xl object-cover ring-1 ring-slate-200" />
                <button
                  type="button"
                  onClick={() => onChange(photos.filter((x) => x.id !== ph.id))}
                  aria-label={`Remove photo ${i + 1}`}
                  className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-lg leading-none text-white hover:bg-black/80"
                >
                  ×
                </button>
              </figure>
            ))}
            {photos.length < max && (
              <label className={`flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed transition focus-within:ring-2 ${tones[tone]}`}>
                {Icon.camera}
                <span className="text-sm font-semibold">Add photo</span>
                {input}
              </label>
            )}
          </div>
          <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
            {Icon.check}Location &amp; EXIF metadata removed · {photos.length}/{max}
          </p>
        </>
      )}
      {err && <p className="mt-2 text-sm text-rose-700">{err}</p>}
    </div>
  );
}

/** Top bar shared by the three screens. */
export function TopBar({ subtitle, bg, session, onSignOut }) {
  return (
    <header className={`sticky top-0 z-20 text-white shadow ${bg}`}>
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
        <div className="mr-auto">
          <p className="text-lg font-bold leading-tight">Civic <span className="text-emerald-300">Accord</span></p>
          <p className="text-xs text-white/75">{subtitle}</p>
        </div>
        {session && (
          <div className="flex items-center gap-2 text-sm">
            <span className="rounded-full bg-white/15 px-3 py-1">Signed in as <b>{session.name}</b></span>
            {onSignOut && (
              <button type="button" onClick={onSignOut} className="rounded-full bg-white px-3 py-1 font-semibold text-slate-900 hover:bg-slate-100">
                Sign out
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

/** Shown when a signed-in user opens a screen that belongs to another role. */
export function AccessDenied({ session, requiredLabel, onSignOut }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div role="alert" className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-700">{Icon.lock}</div>
        <h1 className="mt-4 text-xl font-semibold text-slate-900">Access denied</h1>
        <p className="mt-2 text-sm text-slate-600">
          This screen is only for <b>{requiredLabel}</b>.
          {session ? <> You're signed in as <b>{session.name}</b>.</> : " You're not signed in."}
        </p>
        {onSignOut && (
          <button type="button" onClick={onSignOut} className="mt-6 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black">
            {session ? "Sign out and switch role" : "Go to sign in"}
          </button>
        )}
      </div>
    </div>
  );
}

/** Ledger bar: count, verify integrity, optional reset. */
export function LedgerBar({ events, verify, onReset }) {
  const [res, setRes] = useState(null);
  return (
    <footer className="mt-8 flex flex-wrap items-center gap-3 rounded-2xl bg-slate-900 px-5 py-4 text-sm text-slate-200">
      <p className="mr-auto"><span className="font-semibold text-white">Audit ledger</span> · {events.length} events · SHA-256 hash chain</p>
      {res && !res.checking && (
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${res.ok ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"}`}>
          {res.ok ? `✓ ${res.count} events verified, chain intact` : `✗ Chain broken at event #${res.brokenAt}`}
        </span>
      )}
      <button type="button" onClick={async () => { setRes({ checking: true }); setRes(await verify(events)); }} className="rounded-lg bg-white px-3 py-1.5 font-semibold text-slate-900 hover:bg-slate-100">
        {res && res.checking ? "Verifying…" : "Verify integrity"}
      </button>
      {onReset && (
        <button type="button" onClick={onReset} className="rounded-lg px-3 py-1.5 text-slate-300 ring-1 ring-slate-600 hover:bg-slate-800">Reset demo</button>
      )}
    </footer>
  );
}
