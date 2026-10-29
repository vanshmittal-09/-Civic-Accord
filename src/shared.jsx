// shared.jsx — UI building blocks used by all three persona screens.
import { useState, useEffect, useRef } from "react";
import { STATES, AUTO_CLOSE_MS, HOUR, CLOSED_STATES as CLOSED_STATES_LOCAL } from "./civicLedger";
import logoUrl from "./assets/logo.png";
import { getResident, STAFF_PROFILES } from "./accounts";
import { readPhotoSignals } from "./imageCheck";
import { guardUpload, getWarnings, MAX_WARNINGS } from "./photoGuard";

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
  RATE: "Resident rated the resolution",
  WARN_OFFICER: "Supervisor warned the officer",
  AI_FLAG: "AI detector rejected an officer photo as AI-generated",
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
  new Date(at).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

export function queueMeta(c, now) {
  switch (c.state) {
    case STATES.SUBMITTED: return `Filed on ${stamp(c.submittedAt)}`;
    case STATES.REWORK: return `Rework ordered on ${stamp(c.ruling.at)}`;
    case STATES.PROPOSED: return `Auto-closes in ${dur(c.proposedAt + AUTO_CLOSE_MS - now)}`;
    case STATES.CONTESTED: return `Disputed on ${stamp(c.disputedAt)}`;
    default: return `Closed on ${stamp(c.closedAt || c.updatedAt)}`;
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
        <div className={`mt-3 grid gap-2 ${proof.photos.length > 1 ? "max-w-md grid-cols-3 sm:grid-cols-4" : "max-w-[12rem]"}`}>
          {proof.photos.map((ph, i) => (
            <EvidencePhoto key={i} photo={ph} alt={`${title} ${i + 1}`} gallery={proof.photos} index={i} title={title} compact />
          ))}
        </div>
      ) : (
        <div className="mt-3 max-w-[11rem]"><PhotoBox src={proof.photo} label={proof.photoLabel} tone={tone} /></div>
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
              <p className="text-sm font-medium text-slate-900">{EVENT_LABEL[e.type] || e.type}{e.type === "WARN_OFFICER" && e.data ? `: ${e.data.kind === "TAMPERED" ? "image tampered / fake photo" : "incomplete work"}${e.data.suspends ? " (officer suspended)" : ""}` : ""}{e.type === "AI_FLAG" && e.data ? ` · tampered-image warning${e.data.suspends ? ", officer suspended" : ""}` : ""}</p>
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
          <EvidencePhoto key={i} photo={ph} alt={`Complaint photo ${i + 1}`} gallery={c.photos} index={i} title="Complaint photos" compact={c.photos.length > 1} />
        ))}
      </div>
    );
  }
  return <PhotoBox label={c.photoLabel} tone="citizen" />;
}

/** Multi-photo picker: camera on phones, 24h freshness check, metadata stripped. */
export function PhotoPicker({ photos, onChange, max = MAX_PHOTOS, prompt = "Take photos", hint = "Photos older than 24h are rejected.", tone = "teal", uploader }) {
  const [err, setErr] = useState("");
  const guard = usePhotoGuard(uploader);
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
        const check = await guard.check(f, src); // AI-photo screening (silent for real photos)
        if (!check.ok) { if (check.locked) break; continue; }
        added.push({ id: `${f.name}-${f.lastModified}-${Math.random().toString(36).slice(2, 7)}`, src, capturedAt: f.lastModified, signals: check.signals });
      } catch {
        errors.push(`Couldn't read ${f.name}.`);
      }
    }
    onChange([...photos, ...added].slice(0, max));
    setErr(errors.join(" "));
  }
  const input = <input type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={onFiles} />;
  if (guard.locked && photos.length === 0) return <PhotoGuardNotice guard={guard} />;
  return (
    <div>
      <PhotoGuardNotice guard={guard} />
      {photos.length === 0 ? (
        <label className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-7 text-center transition focus-within:ring-2 ${tones[tone]}`}>
          {Icon.camera}
          <span className="font-semibold">{prompt}</span>
          <span className="text-xs opacity-80">{hint}</span>
          {input}
        </label>
      ) : (
        <>
          <div className="grid max-w-lg grid-cols-3 gap-2 sm:grid-cols-4">
            {photos.map((ph, i) => (
              <figure key={ph.id} className="relative">
                <button type="button" onClick={() => openPhotoViewer(photos, i, "Your photos")} aria-label={`View photo ${i + 1} full screen`} className="block w-full rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
                  <img src={ph.src} alt={`Photo ${i + 1}`} className="aspect-[4/3] w-full rounded-xl object-cover ring-1 ring-slate-200" />
                </button>
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
            {photos.length < max && !guard.locked && (
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
export function TopBar({ subtitle, bg, session, onSignOut, avatarText, stats }) {
  return (
    <header className={`sticky top-0 z-20 text-white shadow ${bg}`}>
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
        <div className="mr-auto flex items-center gap-3">
          <Logo />
          <div>
            <p className="text-lg font-bold leading-tight">Civic <span className="text-emerald-300">Accord</span></p>
            <p className="text-xs text-white/75">{subtitle}</p>
          </div>
        </div>
        {session && (
          <div className="flex items-center gap-2 text-sm">
            <ProfileMenu session={session} onSignOut={onSignOut} textClass={avatarText} accent={bg} stats={stats} />
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

/** Circular initial badge for the signed-in person (full name in tooltip + for screen readers). */
export function Avatar({ session, textClass = "text-slate-900" }) {
  const initial = initialOf(session);
  return (
    <span
      title={`Signed in as ${session.name}`}
      className={`flex h-10 w-10 shrink-0 select-none items-center justify-center rounded-full bg-white text-lg font-bold ring-2 ring-white/40 ${textClass}`}
    >
      <span aria-hidden="true">{initial}</span>
      <span className="sr-only">Signed in as {session.name}</span>
    </span>
  );
}

/** Civic Accord logo in a white circle (works on dark and light backgrounds). */
export function Logo({ className = "h-11 w-11" }) {
  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-2 ring-white/40 ${className}`}>
      <img src={logoUrl} alt="Civic Accord logo" className="h-[86%] w-[86%] object-contain" />
    </span>
  );
}

function initialOf(session) {
  const person = (session.personName || session.name || "?").replace(/^(Resident|Officer|Supervisor|Citizen)\s+/i, "");
  return (person.trim()[0] || "?").toUpperCase();
}

/** Profile icon: click to see the signed-in person's details. Closes on outside click or Escape. */
export function ProfileMenu({ session, onSignOut, textClass = "text-slate-900", accent = "bg-slate-900", stats = [] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isResident = session.role === "CITIZEN";
  const profile = isResident ? (session.profile || getResident(session.personId)) : STAFF_PROFILES[session.personId];
  const displayName = (profile && profile.name) || session.personName || session.name;
  const roleLabel = isResident ? "Resident" : (profile && profile.role) || session.role;
  const fmtMobile = (m) => (m ? `+91 ${m.slice(0, 5)} ${m.slice(5)}` : "");
  const rows = isResident
    ? [
        ["Mobile", profile && fmtMobile(profile.mobile)],
        ["Email", profile && profile.email],
        ["Address", profile && [profile.address, profile.city, profile.pincode].filter(Boolean).join(", ")],
        ["Member since", profile && profile.createdAt && new Date(profile.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })],
      ]
    : [
        ["Staff ID", profile && profile.staffId],
        ["Department", profile && profile.department],
        ["Zone", profile && profile.zone],
        ["Email", profile && profile.email],
      ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Open profile for ${displayName}`}
        className="block rounded-full focus:outline-none focus-visible:ring-4 focus-visible:ring-white/60"
      >
        <Avatar session={session} textClass={textClass} />
      </button>
      {open && (
        <div role="dialog" aria-label="Your profile" className="fixed inset-x-4 top-24 z-40 overflow-hidden sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-80 rounded-2xl bg-white text-left text-slate-900 shadow-xl ring-1 ring-slate-200">
          <div className={`flex items-center gap-3 px-5 py-4 text-white ${accent}`}>
            <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white text-2xl font-bold ${textClass}`}>{initialOf(session)}</span>
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold">{displayName}</p>
              <p className="text-xs text-white/80">{roleLabel}</p>
            </div>
          </div>
          <dl className="divide-y divide-slate-100 px-5 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[100px_1fr] gap-2 py-2.5">
                <dt className="text-slate-500">{k}</dt>
                <dd className="min-w-0 break-words font-medium">{v || <span className="font-normal text-slate-400">Not provided</span>}</dd>
              </div>
            ))}
          </dl>
          {stats && stats.length > 0 && (
            <div className="grid gap-2 border-t border-slate-100 px-5 py-4 text-center" style={{ gridTemplateColumns: `repeat(${Math.min(stats.length, 4)}, minmax(0, 1fr))` }}>
              {stats.map((st) => (
                <div key={st.label} className="rounded-xl bg-slate-50 px-1 py-2 ring-1 ring-slate-200">
                  <p className="text-lg font-bold tabular-nums">{st.value}</p>
                  <p className="text-[11px] leading-tight text-slate-500">{st.label}</p>
                </div>
              ))}
            </div>
          )}
          {onSignOut && (
            <div className="border-t border-slate-100 p-3">
              <button type="button" onClick={onSignOut} className="w-full rounded-xl px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50">Sign out</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One evidence photo. Demo-data illustrations get a small "Sample image" tag. */
export function EvidencePhoto({ photo, alt, hideSampleTag = false, gallery, index = 0, title = "", compact = false }) {
  const list = gallery && gallery.length ? gallery : [photo];
  return (
    <figure className="relative">
      <button
        type="button"
        onClick={() => openPhotoViewer(list, gallery ? index : 0, title || alt)}
        aria-label={`View ${alt} full screen`}
        className="group relative block w-full overflow-hidden rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
      >
        <img src={photo.src} alt={alt} className="aspect-[4/3] w-full rounded-xl object-cover ring-1 ring-slate-200 transition group-hover:brightness-90" />
        <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
        </span>
      </button>
      {photo.sample && !hideSampleTag && (
        <figcaption className={`pointer-events-none absolute bottom-1.5 left-1.5 rounded-md bg-black/55 font-medium uppercase tracking-wide text-white ${compact ? "px-1 py-px text-[8px]" : "px-1.5 py-0.5 text-[10px]"}`}>
          Sample
        </figcaption>
      )}
    </figure>
  );
}

/* ---------------- full-screen photo viewer ---------------- */
/** Opens the full-screen viewer from anywhere in the app. */
export function openPhotoViewer(photos, index = 0, title = "") {
  const list = (photos || []).filter((p) => p && p.src);
  if (!list.length) return;
  window.dispatchEvent(new CustomEvent("civic:photo-viewer", { detail: { photos: list, index: Math.min(index, list.length - 1), title } }));
}

/** Mount once (in App). Shows photos full screen: arrows / swipe to move, Esc or × to close. */
export function PhotoViewer() {
  const [view, setView] = useState(null);
  const closeRef = useRef(null);
  const touch = useRef(null);

  useEffect(() => {
    const onOpen = (e) => setView(e.detail);
    window.addEventListener("civic:photo-viewer", onOpen);
    return () => window.removeEventListener("civic:photo-viewer", onOpen);
  }, []);

  const count = view ? view.photos.length : 0;
  const go = (d) => setView((v) => (v ? { ...v, index: (v.index + d + v.photos.length) % v.photos.length } : v));

  useEffect(() => {
    if (!view) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setView(null);
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (closeRef.current) closeRef.current.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [view ? view.title : null, count]);

  if (!view) return null;
  const photo = view.photos[view.index];
  const navBtn = "absolute top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-2xl text-white hover:bg-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-white";

  return (
    <div
      role="dialog" aria-modal="true" aria-label={view.title || "Photo"}
      className="fixed inset-0 z-[60] flex flex-col bg-black"
      onMouseDown={(e) => { if (e.target === e.currentTarget) setView(null); }}
      onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touch.current == null || count < 2) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        touch.current = null;
      }}
    >
      <div className="flex items-center gap-3 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">
          {view.title}{count > 1 ? ` · ${view.index + 1} of ${count}` : ""}
        </p>
        <button ref={closeRef} type="button" onClick={() => setView(null)} aria-label="Close photo" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-2xl leading-none hover:bg-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-white">×</button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-[max(1rem,env(safe-area-inset-bottom))]" onMouseDown={(e) => { if (e.target === e.currentTarget) setView(null); }}>
        <img src={photo.src} alt={`${view.title} ${view.index + 1}`} className="h-full w-full object-contain" />
        {photo.sample && <span className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-md bg-black/60 px-2 py-0.5 text-xs uppercase tracking-wide text-white">Sample illustration</span>}
        {count > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label="Previous photo" className={`${navBtn} left-3`}>‹</button>
            <button type="button" onClick={() => go(1)} aria-label="Next photo" className={`${navBtn} right-3`}>›</button>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------- site-wide announcements + footer ---------------- */
// ✏️ Replace these placeholders with your team's real helpline details.
export const SUPPORT = {
  phone: "1800-XXX-XXXX",
  email: "yourteam.helpline@gmail.com",
  hours: "Mon–Sat, 6 AM – 6 PM",
};

export const ANNOUNCEMENTS = [
  "Special cleanliness drive in Sectors 14–17 this Saturday, 7–11 AM.",
  "From 1 Nov, please keep wet and dry waste in separate bags.",
  "Bulk waste pickup (furniture, debris) needs 24 hours' notice. Mention it in your complaint.",
  "Sector 16 collection now starts at 6:30 AM.",
];

function Megaphone() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z" /><path d="M15 9a4 4 0 0 1 0 6" /><path d="M18 6a8 8 0 0 1 0 12" />
    </svg>
  );
}

export function AnnouncementBar() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setI((n) => (n + 1) % ANNOUNCEMENTS.length), 6000);
    return () => clearInterval(t);
  }, [paused]);
  const go = (d) => setI((n) => (n + d + ANNOUNCEMENTS.length) % ANNOUNCEMENTS.length);
  return (
    <section
      aria-label="Announcements"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="border-y border-amber-200 bg-amber-50 text-amber-950"
    >
      <div className="mx-auto flex h-11 max-w-7xl items-center gap-3 px-4">
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-amber-400 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-amber-950">
          <Megaphone /><span className="hidden sm:inline">Announcements</span>
        </span>
        <p key={i} aria-live="polite" className="min-w-0 flex-1 truncate text-sm">{ANNOUNCEMENTS[i]}</p>
        <span className="hidden shrink-0 text-xs tabular-nums text-amber-800 sm:inline">{i + 1}/{ANNOUNCEMENTS.length}</span>
        <div className="flex shrink-0 gap-1">
          <button type="button" onClick={() => go(-1)} aria-label="Previous announcement" className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-amber-200">‹</button>
          <button type="button" onClick={() => go(1)} aria-label="Next announcement" className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-amber-200">›</button>
        </div>
      </div>
    </section>
  );
}

function PrivacyDialog({ onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const H = ({ children }) => <h3 className="mt-5 font-semibold text-slate-900">{children}</h3>;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="privacy-title" className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 text-left text-sm leading-relaxed text-slate-700 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <h2 id="privacy-title" className="text-xl font-semibold text-slate-900">Privacy Policy</h2>
          <button type="button" onClick={onClose} aria-label="Close privacy policy" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg hover:bg-slate-100">×</button>
        </div>
        <p className="mt-1 text-xs text-slate-500">Civic Accord · last updated 29 Oct 2026</p>

        <H>What we collect</H>
        <p>For residents: your name, mobile number, Gmail address and home address, the complaints you file, and the photos you attach. For staff: name, staff ID and the actions you take on cases.</p>

        <H>Why we collect it</H>
        <p>Only to register, route and resolve civic complaints, and to let you verify that work was done. We don't sell your data or use it for advertising.</p>

        <H>Photos and location</H>
        <p>Before any photo is saved, the app removes its hidden metadata (EXIF), including GPS location. To help supervisors check that photos are genuine and not AI-generated, it keeps only the camera make and model, the time the photo was taken, and the name of any editing software. Every photo is checked when uploaded: if it looks AI-generated, it isn't added and a warning is recorded on your account. After 3 warnings, photo uploads are blocked until a supervisor reviews the account. Please avoid photographing people's faces or vehicle number plates.</p>

        <H>Who can see what</H>
        <p>Residents see only their own complaints. The assigned field officer sees complaints in their zone. Supervisors see disputed cases to make a ruling. Your mobile number and address are shown only on your own profile.</p>

        <H>Security</H>
        <p>Your PIN is never stored as plain text, only as a salted SHA-256 hash. Every action on a case is recorded in a tamper-evident audit ledger.</p>

        <H>Where data is stored</H>
        <p>In this prototype, all data stays in your browser on this device and is not sent to any server. Clearing your browser data deletes it. A production version would store data on secure municipal servers.</p>

        <H>Your choices</H>
        <p>You can ask us to correct or delete your account by contacting the helpline at {SUPPORT.phone} or {SUPPORT.email}.</p>

        <button type="button" onClick={onClose} className="mt-6 w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white hover:bg-black">Close</button>
      </div>
    </div>
  );
}

function CopyText({ value, label }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* user can select the text */ }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <span className="select-all font-semibold text-white">{value}</span>
      <button type="button" onClick={copy} aria-label={`Copy ${label}`} className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-slate-300 ring-1 ring-slate-600 hover:bg-slate-800">
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

/** Bottom of every page: announcement bar, then helpline + privacy footer. */
export function SiteFooter({ showAnnouncements = true }) {
  const [privacy, setPrivacy] = useState(false);
  return (
    <div className="mt-10">
      {showAnnouncements && <AnnouncementBar />}
      <footer className="bg-slate-900 text-slate-300">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 text-sm sm:grid-cols-3">
          <div className="flex items-start gap-3">
            <Logo className="h-10 w-10" />
            <div>
              <p className="font-semibold text-white">Civic Accord</p>
              <p className="text-xs text-slate-400">Transparent Systems. Stronger Communities.</p>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Helpline</p>
            <p className="flex flex-wrap items-center gap-x-2"><span className="w-12 text-slate-400">Phone</span><CopyText value={SUPPORT.phone} label="helpline number" /></p>
            <p className="flex flex-wrap items-center gap-x-2"><span className="w-12 text-slate-400">Gmail</span><CopyText value={SUPPORT.email} label="helpline email" /></p>
            <p className="text-xs text-slate-400">{SUPPORT.hours}</p>
          </div>
          <div className="space-y-2 sm:text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Legal</p>
            <button type="button" onClick={() => setPrivacy(true)} className="font-semibold text-white underline underline-offset-4 hover:text-emerald-300">Privacy Policy</button>
            <p className="text-xs text-slate-400">© 2026 Team Omniverse. Prototype with synthetic data.</p>
          </div>
        </div>
      </footer>
      {privacy && <PrivacyDialog onClose={() => setPrivacy(false)} />}
    </div>
  );
}

/* ---------------- star ratings ---------------- */
export const RATING_WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];

function Star({ filled, className = "h-5 w-5" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"
        fill={filled ? "#f59e0b" : "none"} stroke={filled ? "#f59e0b" : "#cbd5e1"} strokeWidth="1.6" strokeLinejoin="round"
      />
    </svg>
  );
}

/** Read-only stars, e.g. ★★★★☆ 4/5. */
export function StarRating({ value, size = "h-4 w-4", showNumber = true }) {
  const v = Math.round(value || 0);
  return (
    <span className="inline-flex items-center gap-1" title={`${value} out of 5`}>
      <span className="inline-flex" aria-hidden="true">{[1, 2, 3, 4, 5].map((n) => <Star key={n} filled={n <= v} className={size} />)}</span>
      <span className="sr-only">{value} out of 5 stars</span>
      {showNumber && <span className="text-xs font-semibold tabular-nums text-slate-700">{Number(value).toFixed(Number.isInteger(value) ? 0 : 1)}/5</span>}
    </span>
  );
}

/** Tap a star to choose 1–5. */
export function StarPicker({ value, onChange, idPrefix = "rate" }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div>
      <div role="radiogroup" aria-label="Your rating out of 5" className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            id={`${idPrefix}-${n}`}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n > 1 ? "s" : ""}, ${RATING_WORDS[n]}`}
            onClick={() => onChange(n)}
            onMouseEnter={() => setHover(n)}
            className="rounded-md p-0.5 transition hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            <Star filled={n <= shown} className="h-9 w-9" />
          </button>
        ))}
        <span className="ml-2 text-sm font-medium text-slate-700">{shown ? RATING_WORDS[shown] : "Tap a star"}</span>
      </div>
    </div>
  );
}

/** Shows a resident's rating and comment. */
export function RatingCard({ rating, who }) {
  if (!rating) return null;
  return (
    <section className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
      <div className="flex flex-wrap items-center gap-2">
        <StarRating value={rating.stars} size="h-5 w-5" />
        <span className="text-sm font-semibold text-amber-950">{RATING_WORDS[rating.stars]}</span>
        <span className="text-xs text-amber-900/70">· {who} · {stamp(rating.at)}</span>
      </div>
      {rating.comment && <p className="mt-2 text-sm italic text-amber-950">“{rating.comment}”</p>}
    </section>
  );
}

/** Average stars across rated cases (null when none). */
export function averageRating(cases) {
  const rated = cases.filter((c) => c.rating);
  if (!rated.length) return null;
  return { avg: rated.reduce((t, c) => t + c.rating.stars, 0) / rated.length, count: rated.length };
}

/* ---------------- live complaint timer ---------------- */
// Deadline to resolve new complaints and ordered rework: 72 hours.
export const ACTION_SLA_MS = 72 * HOUR;

function useTick(ms = 1000) {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return t;
}

/** 2d 3h 05m, or 04:12:09 when under a day. */
function clockText(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const p = (n) => String(n).padStart(2, "0");
  return d ? `${d}d ${h}h ${p(m)}m` : `${p(h)}:${p(m)}:${p(sec)}`;
}

const TimerIcon = () => (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2" /><path d="M9.5 2.5h5" />
  </svg>
);

/**
 * Live timer for a complaint:
 *  - resolved: how long it took
 *  - open: time since it was reported (ticks every second)
 *  - new or rework: countdown to the 72-hour resolution deadline
 */
export function CaseTimer({ c }) {
  const now = useTick(1000);
  const chip = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums";

  if (CLOSED_STATES_LOCAL.includes(c.state)) {
    const took = (c.closedAt || c.updatedAt) - c.submittedAt;
    return <span className={`${chip} bg-emerald-100 text-emerald-800`}><TimerIcon />Resolved in {clockText(took)}</span>;
  }

  const openFor = now - c.submittedAt;
  const needsAction = c.state === STATES.SUBMITTED || c.state === STATES.REWORK;
  let deadline = null;
  if (needsAction) {
    const start = c.state === STATES.REWORK && c.ruling ? c.ruling.at : c.submittedAt;
    const left = start + ACTION_SLA_MS - now;
    const tone = left < 0 ? "bg-rose-600 text-white" : left < 12 * HOUR ? "bg-amber-100 text-amber-900" : "bg-sky-100 text-sky-800";
    deadline = (
      <span className={`${chip} ${tone}`} title="Complaint must be resolved within 72 hours">
        {left < 0 ? `Overdue by ${clockText(-left)}` : `Resolve within ${clockText(left)}`}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={`${chip} bg-slate-100 text-slate-700`} aria-label={`Open for ${clockText(openFor)}`}><TimerIcon />Open {clockText(openFor)}</span>
      {deadline}
    </span>
  );
}

/* ---------------- AI-photo screening on upload (shared by every form) ---------------- */
/** Screens uploads for one account. Real photos pass silently; AI photos get a warning (max 3). */
/**
 * AI-photo screening for one uploader.
 * Residents: warnings are stored per account; at MAX_WARNINGS the account is suspended
 *            (no new complaints or disputes until the helpline/supervisor lifts it).
 * Officers:  pass { onFlag, suspended } — each flag goes into the audit ledger as a
 *            tampered-image warning, which the supervisor sees and which counts toward suspension.
 */
export function usePhotoGuard(uploader, opts = {}) {
  const [count, setCount] = useState(0);
  const [notice, setNotice] = useState(null);
  const uid = uploader && uploader.id;
  const ledgerMode = typeof opts.onFlag === "function";
  useEffect(() => {
    if (!uid || ledgerMode) return;
    let alive = true;
    const load = () => getWarnings(uid).then((w) => { if (alive) setCount(w.length); }).catch(() => {});
    load();
    window.addEventListener("photoguard:change", load);
    return () => { alive = false; window.removeEventListener("photoguard:change", load); };
  }, [uid, ledgerMode]);
  const locked = ledgerMode ? Boolean(opts.suspended) : count >= MAX_WARNINGS;
  async function check(file, src) {
    if (!uploader) return { ok: true, signals: await readPhotoSignals(file) };
    if (locked) return { ok: false, locked: true };
    if (ledgerMode) {
      const r = await guardUpload(file, src, uploader, { record: false });
      if (!r.ok) {
        const info = (await opts.onFlag(r.flagged)) || {};
        setNotice({ officer: true, reason: r.flagged.reason, detector: r.flagged.detector, count: info.count, suspended: info.suspended });
        return { ok: false, locked: Boolean(info.suspended) };
      }
      return r;
    }
    const r = await guardUpload(file, src, uploader);
    if (!r.ok) {
      setCount(r.count);
      setNotice({ count: r.count, reason: r.reason, detector: r.flagged && r.flagged.detector });
    }
    return r;
  }
  return { count, locked, notice, check, dismiss: () => setNotice(null) };
}

export function PhotoGuardNotice({ guard }) {
  const n = guard.notice;
  if (n && n.officer) {
    return (
      <div role="alert" className={`mb-3 rounded-xl p-4 text-sm ring-1 ${n.suspended ? "bg-rose-50 text-rose-900 ring-rose-300" : "bg-amber-50 text-amber-950 ring-amber-300"}`}>
        <div className="flex items-start justify-between gap-3">
          <p className="font-semibold">⚠ {n.detector || "AI detector"}: this photo looks AI-generated, so it wasn't added</p>
          <button type="button" onClick={guard.dismiss} aria-label="Dismiss warning" className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-lg hover:bg-black/5">×</button>
        </div>
        <p className="mt-1">
          A tampered-image warning has been recorded{n.count != null ? ` (${n.count} this week)` : ""} and your supervisor has been notified.
          {n.suspended ? " You have exceeded the weekly limit and are now suspended." : " More than 3 warnings in a week means suspension."}
        </p>
        <p className="mt-1 text-xs opacity-70">Reason: {n.reason}</p>
      </div>
    );
  }
  if (guard.locked && !n) {
    return (
      <div role="alert" className="mb-3 rounded-xl bg-rose-50 p-4 text-sm text-rose-900 ring-1 ring-rose-300">
        <p className="font-semibold">Your account is suspended</p>
        <p className="mt-1">You've received {MAX_WARNINGS} warnings for uploading AI-generated photos, so you can't submit complaints or upload photos. To restore your account, contact the helpline on {SUPPORT.phone}.</p>
      </div>
    );
  }
  if (n) {
    const last = n.count >= MAX_WARNINGS;
    return (
      <div role="alert" className={`mb-3 rounded-xl p-4 text-sm ring-1 ${last ? "bg-rose-50 text-rose-900 ring-rose-300" : "bg-amber-50 text-amber-950 ring-amber-300"}`}>
        <div className="flex items-start justify-between gap-3">
          <p className="font-semibold">⚠ {n.detector || "AI detector"}: this photo is AI-generated. You can't submit a complaint with it.</p>
          <button type="button" onClick={guard.dismiss} aria-label="Dismiss warning" className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-lg hover:bg-black/5">×</button>
        </div>
        <p className="mt-1 font-medium">
          {last
            ? `Warning ${n.count} of ${MAX_WARNINGS}: your account is now suspended. You can't submit complaints until the helpline restores it.`
            : `Warning ${n.count} of ${MAX_WARNINGS}: at ${MAX_WARNINGS} warnings your account will be suspended.`}
        </p>
        <p className="mt-1">Please take a real photo of the issue at the site.</p>
        <p className="mt-1 text-xs opacity-70">Reason: {n.reason}</p>
      </div>
    );
  }
  if (guard.count > 0) {
    return <p className="mb-2 text-xs font-medium text-amber-800">You have {guard.count} of {MAX_WARNINGS} warnings for AI-generated photos. At {MAX_WARNINGS}, your account is suspended.</p>;
  }
  return null;
}
