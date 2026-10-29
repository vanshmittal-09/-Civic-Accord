// OfficerView.jsx — Field Officer screen for Civic Accord.
// Officers never close cases: they submit a Resolution Proposal with photo proof,
// then the citizen confirms / disputes, or the 72h timer closes it as Uncontested.
import { useState, useMemo, useEffect } from "react";
import {
  STATES, CLOSED_STATES, AUTO_CLOSE_MS, HOUR, PEOPLE,
  checkTransition, useCivicLedger, useNow, verifyLedger,
} from "./civicLedger";
import {
  STATUS_META, EVENT_LABEL, CHECKS, CHECK_LABEL, dur, ago, stamp, queueMeta, stripAndCompress,
  StatusBadge, Icon, PhotoBox, Chip, Card, ProofCard, Timeline, ComplaintPhotos, AccessDenied, ProfileMenu, Logo, SiteFooter, RatingCard, averageRating, StarRating, CaseTimer,
} from "./shared";
import { readPhotoSignals } from "./imageCheck";

const ME = PEOPLE.damodar;
const MIN_NOTE = 20;
const MAX_PHOTO_AGE_MS = 24 * HOUR;
const MAX_PHOTOS = 4;

/* ---------------- resolution proposal form ---------------- */
function ProposalForm({ c, now, onSubmit, isRework }) {
  const [photos, setPhotos] = useState([]);
  const [photoErr, setPhotoErr] = useState("");
  const [note, setNote] = useState("");
  const [checks, setChecks] = useState(() => Object.fromEntries(CHECKS.map((c) => [c.key, false])));
  const [busy, setBusy] = useState(false);

  const checklist = Object.keys(checks).filter((k) => checks[k]);
  const noteOk = note.trim().length >= MIN_NOTE;
  const valid = photos.length > 0 && noteOk && checklist.length > 0;

  async function onFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    const room = MAX_PHOTOS - photos.length;
    const errors = [];
    const added = [];
    for (const f of files) {
      if (added.length >= room) { errors.push(`Only ${MAX_PHOTOS} photos allowed.`); break; }
      if (!f.type.startsWith("image/")) { errors.push(`${f.name} isn't an image.`); continue; }
      if (Date.now() - f.lastModified > MAX_PHOTO_AGE_MS) {
        errors.push(`${f.name} is more than 24 hours old. Take a fresh photo at the site.`);
        continue;
      }
      try {
        const signals = await readPhotoSignals(f); // read before the metadata is stripped
        const src = await stripAndCompress(f);
        added.push({
          signals,
          id: `${f.name}-${f.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
          src,
          capturedAt: f.lastModified,
          originalKB: Math.round(f.size / 1024),
          finalKB: Math.round((src.length * 0.75) / 1024),
        });
      } catch {
        errors.push(`Couldn't read ${f.name}.`);
      }
    }
    setPhotos((ps) => [...ps, ...added].slice(0, MAX_PHOTOS));
    setPhotoErr(errors.join(" "));
  }

  async function submit(e) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    await onSubmit({
      note: note.trim(),
      checklist,
      photos: photos.map(({ src, capturedAt, signals }) => ({ src, capturedAt, signals })),
      photoLabel: "Officer completion photos",
      capturedAt: Math.min(...photos.map((ph) => ph.capturedAt)),
      metadataStripped: true,
    });
    setBusy(false);
  }

  return (
    <Card>
      <form onSubmit={(e) => e.preventDefault()} className="space-y-5">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{isRework ? "Submit fresh proof" : "Propose resolution"}</h3>
          <p className="mt-1 text-sm text-slate-600">
            You can't close this case yourself. Submit proof of the work, and {c.citizenName} will confirm or dispute it within 72 hours.
          </p>
        </div>

        {/* step 1 — photos */}
        <div>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-slate-800">1. Completion photos <span className="font-normal text-slate-500">(up to {MAX_PHOTOS})</span></p>
            <p className={`whitespace-nowrap text-xs ${photos.length ? "text-emerald-700" : "text-slate-500"}`}>{photos.length}/{MAX_PHOTOS} added</p>
          </div>
          {photos.length === 0 ? (
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-teal-300 bg-teal-50/60 px-4 py-8 text-center text-teal-800 transition hover:bg-teal-50 focus-within:ring-2 focus-within:ring-teal-500">
              {Icon.camera}
              <span className="font-semibold">Take photos at the site</span>
              <span className="text-xs text-teal-700/80">Add a wide shot and close-ups. Photos older than 24h are rejected.</span>
              <input type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={onFiles} />
            </label>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {photos.map((ph, i) => (
                  <figure key={ph.id} className="relative">
                    <img src={ph.src} alt={`Completion proof ${i + 1}`} className="aspect-[4/3] w-full rounded-xl object-cover ring-1 ring-slate-200" />
                    <button
                      type="button"
                      onClick={() => setPhotos((ps) => ps.filter((x) => x.id !== ph.id))}
                      aria-label={`Remove photo ${i + 1}`}
                      className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-lg leading-none text-white hover:bg-black/80"
                    >
                      ×
                    </button>
                    <figcaption className="mt-1 text-[11px] text-slate-500">Captured {stamp(ph.capturedAt)}</figcaption>
                  </figure>
                ))}
                {photos.length < MAX_PHOTOS && (
                  <label className="flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-teal-300 bg-teal-50/60 text-teal-800 transition hover:bg-teal-50 focus-within:ring-2 focus-within:ring-teal-500">
                    {Icon.camera}
                    <span className="text-sm font-semibold">Add photo</span>
                    <input type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={onFiles} />
                  </label>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Chip tone="green">{Icon.check}EXIF &amp; GPS metadata removed from all photos</Chip>
                <Chip>
                  {photos.reduce((t, ph) => t + ph.originalKB, 0)} KB → {photos.reduce((t, ph) => t + ph.finalKB, 0)} KB
                </Chip>
              </div>
            </>
          )}
          {photoErr && <p className="mt-2 text-sm text-rose-700">{photoErr}</p>}
        </div>

        {/* step 2 — checklist */}
        <div>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-slate-800">2. Work completed <span className="font-normal text-slate-500">(select all that apply)</span></p>
            <p className={`whitespace-nowrap text-xs ${checklist.length ? "text-emerald-700" : "text-slate-500"}`}>{checklist.length} selected</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {CHECKS.map(({ key, label }) => {
              const on = checks[key];
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setChecks((s) => ({ ...s, [key]: !s[key] }))}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition ${
                    on ? "bg-teal-700 text-white ring-teal-700" : "bg-white text-slate-700 ring-slate-300 hover:ring-teal-500"
                  }`}
                >
                  {on && Icon.check}
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* step 3 — note */}
        <div>
          <label htmlFor={`note-${c.id}`} className="mb-2 block text-sm font-medium text-slate-800">3. Completion note</label>
          <textarea
            id={`note-${c.id}`}
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What was done, and anything left for another team (e.g. bulk pickup needed)."
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
          />
          <p className={`mt-1 text-xs ${noteOk ? "text-emerald-700" : "text-slate-500"}`}>
            {note.trim().length}/{MIN_NOTE} characters minimum
          </p>
        </div>

        <button
          type="button" onClick={submit}
          disabled={!valid || busy}
          className="w-full rounded-xl bg-teal-700 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {busy ? "Sealing into ledger…" : "Submit resolution proposal"}
        </button>
        {!valid && (
          <p className="text-center text-xs text-slate-500">Needs at least one photo, one completed item and a note.</p>
        )}
      </form>
    </Card>
  );
}

/* ---------------- state-specific panels ---------------- */
function WaitingPanel({ c, now }) {
  const remaining = c.proposedAt + AUTO_CLOSE_MS - now;
  const pct = Math.min(100, Math.max(0, ((now - c.proposedAt) / AUTO_CLOSE_MS) * 100));
  return (
    <>
      <section className="rounded-2xl bg-amber-50 p-5 ring-1 ring-amber-200">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-md">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-amber-950">{Icon.clock}Waiting for {c.citizenName}</h3>
            <p className="mt-1 text-sm text-amber-900/80">
              The citizen can confirm or dispute your proof. With no response, the case closes automatically as “Uncontested Closure”.
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-amber-800">Auto-closes in</p>
            <p className="text-2xl font-bold tabular-nums text-amber-950">{dur(remaining)}</p>
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-amber-200/70" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-3 text-xs text-amber-900/70">Read-only. Officers can't edit or close a proposed case.</p>
      </section>
      <ProofCard title="Your submitted proof" proof={c.proposal} at={c.proposedAt} />
    </>
  );
}

function ContestedPanel({ c }) {
  const [blocked, setBlocked] = useState("");
  return (
    <>
      <section className="rounded-2xl bg-rose-50 p-5 ring-1 ring-rose-200">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-rose-900">{Icon.lock}Locked: under supervisor review</h3>
        <p className="mt-1 text-sm text-rose-900/80">
          {c.citizenName} disputed your resolution. Supervisor Patel will compare both sides and issue a reasoned ruling. Officers cannot close disputed cases.
        </p>
        <button
          type="button"
          onClick={() => setBlocked(checkTransition(c, "UPHOLD", ME.role, ME.id) || "Allowed")}
          className="mt-4 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-rose-800 ring-1 ring-rose-300 hover:bg-rose-100"
        >
          Try to close this case
        </button>
        {blocked && (
          <p role="alert" className="mt-3 rounded-lg bg-rose-900 px-3 py-2 font-mono text-xs text-rose-50">{blocked}</p>
        )}
      </section>
      <div className="grid gap-4 md:grid-cols-2">
        <ProofCard title="Your proof" proof={c.proposal} at={c.proposedAt} />
        <ProofCard title={`${c.citizenName}'s counter-proof`} proof={c.dispute} at={c.disputedAt} tone="citizen" />
      </div>
    </>
  );
}

function ClosedPanel({ c }) {
  const text = {
    [STATES.CONFIRMED]: [`Closed: ${c.citizenName} confirmed the work`, "Bilateral verification complete."],
    [STATES.UNCONTESTED]: ["Closed: Uncontested Closure", c.autoClose?.reason || "No citizen response within 72 hours."],
    [STATES.REVIEWER_CLOSED]: ["Closed by supervisor ruling", c.ruling?.ruling || ""],
  }[c.state] || ["Closed", ""];
  return (
    <>
      <section className="rounded-2xl bg-emerald-50 p-5 ring-1 ring-emerald-200">
        <h3 className="text-lg font-semibold text-emerald-900">{text[0]}</h3>
        {text[1] && <p className="mt-1 text-sm text-emerald-900/80">{text[1]}</p>}
      </section>
      {c.rating ? <RatingCard rating={c.rating} who="Resident's rating" /> : (
        <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500 ring-1 ring-slate-200">The resident hasn't rated this resolution yet.</p>
      )}
      <ProofCard title="Your submitted proof" proof={c.proposal} at={c.proposedAt} />
    </>
  );
}

function CaseDetail({ c, now, onPropose }) {
  let panel;
  if (c.state === STATES.SUBMITTED) {
    panel = <ProposalForm key={c.id + c.events.length} c={c} now={now} onSubmit={(d) => onPropose(c, d)} />;
  } else if (c.state === STATES.REWORK) {
    panel = (
      <>
        <section className="rounded-2xl bg-violet-50 p-5 ring-1 ring-violet-200">
          <h3 className="text-lg font-semibold text-violet-900">{c.ruling.by} ordered rework</h3>
          <p className="mt-1 text-sm leading-relaxed text-violet-900/85">{c.ruling.ruling}</p>
          <p className="mt-2 text-xs text-violet-900/60">{stamp(c.ruling.at)}</p>
        </section>
        <ProposalForm key={c.id + c.events.length} c={c} now={now} isRework onSubmit={(d) => onPropose(c, d)} />
      </>
    );
  } else if (c.state === STATES.PROPOSED) {
    panel = <WaitingPanel c={c} now={now} />;
  } else if (c.state === STATES.CONTESTED) {
    panel = <ContestedPanel key={c.id} c={c} />;
  } else {
    panel = <ClosedPanel c={c} />;
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs text-slate-500">CASE #{c.id} · {c.category}</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-900">{c.title}</h2>
            <p className="mt-0.5 text-sm text-slate-600">{c.location}</p>
            <div className="mt-2"><CaseTimer c={c} /></div>
          </div>
          <StatusBadge state={c.state} />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-[180px_1fr]">
          <ComplaintPhotos c={c} />
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Reported by {c.citizenName}</p>
            <p className="text-xs text-slate-500">{stamp(c.submittedAt)}</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">{c.description}</p>
          </div>
        </div>
      </Card>
      {panel}
      <Timeline c={c} />
    </div>
  );
}

/* ---------------- page ---------------- */
const FILTERS = [
  { key: "action", label: "Unresolved complaints", hint: "New + rework", accent: "text-sky-700" },
  { key: "waiting", label: "Submitted", hint: "Waiting for citizen (72h)", accent: "text-amber-700" },
  { key: "review", label: "Forwarded", hint: "Disputed, sent to supervisor", accent: "text-rose-700" },
  { key: "closed", label: "Completed", hint: "All closed cases", accent: "text-emerald-700" },
];

export default function OfficerView({ session, onSignOut }) {
  if (!session || session.role !== "OFFICER") {
    return <AccessDenied session={session} requiredLabel="Field Officers" onSignOut={onSignOut} />;
  }
  return <OfficerScreen session={session} onSignOut={onSignOut} />;
}

function OfficerScreen({ session, onSignOut }) {
  const now = useNow();
  const { ready, events, cases, dispatch, reset, storageWarning } = useCivicLedger(now);
  const [filter, setFilter] = useState("action");
  const [selectedId, setSelectedId] = useState(null);
  const [toast, setToast] = useState(null);
  const [integrity, setIntegrity] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => { setIntegrity(null); }, [events.length]);

  const groups = useMemo(() => {
    const mine = cases.filter((c) => c.assignedTo === ME.id);
    const by = (states) => mine.filter((c) => states.includes(c.state));
    return {
      // rework first (overdue), then oldest complaint first
      action: by([STATES.REWORK, STATES.SUBMITTED]).sort(
        (a, b) => (a.state === STATES.REWORK ? 0 : 1) - (b.state === STATES.REWORK ? 0 : 1) || a.submittedAt - b.submittedAt
      ),
      waiting: by([STATES.PROPOSED]).sort((a, b) => a.proposedAt - b.proposedAt),
      review: by([STATES.CONTESTED]),
      closed: by(CLOSED_STATES).sort((a, b) => b.updatedAt - a.updatedAt),
      all: mine,
    };
  }, [cases]);

  const list = groups[filter];
  const selected = groups.all.find((c) => c.id === selectedId && list.includes(c)) || list[0] || null;

  async function handlePropose(c, data) {
    try {
      await dispatch(c.id, "PROPOSE", ME, data);
      setToast({ ok: true, text: `Resolution proposed for #${c.id}. ${c.citizenName} has 72 hours to respond.` });
      setFilter("waiting");
      setSelectedId(c.id);
    } catch (err) {
      setToast({ ok: false, text: err.message });
    }
  }

  async function handleVerify() {
    setIntegrity({ checking: true });
    setIntegrity(await verifyLedger(events));
  }

  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    if (!confirmReset) return;
    const t = setTimeout(() => setConfirmReset(false), 4000);
    return () => clearTimeout(t);
  }, [confirmReset]);

  async function handleReset() {
    // two-step confirm (browser confirm() dialogs are blocked in shared previews)
    if (!confirmReset) { setConfirmReset(true); return; }
    setConfirmReset(false);
    await reset();
    setFilter("action");
    setSelectedId(null);
    setToast({ ok: true, text: "Demo reset. Synthetic cases reloaded." });
  }


  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* top bar */}
      <header className="sticky top-0 z-20 bg-[#0e4f4f] text-white shadow">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="mr-auto flex items-center gap-3">
            <Logo />
            <div>
              <p className="text-lg font-bold leading-tight">Civic <span className="text-emerald-300">Accord</span></p>
              <p className="text-xs text-teal-100/80">Field Officer workspace · Municipal Corporation, Sectors 14–17</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <ProfileMenu
              session={session} onSignOut={onSignOut} textClass="text-[#0e4f4f]" accent="bg-[#0e4f4f]"
              stats={[
                { label: "Assigned", value: groups.all.length },
                { label: "Open", value: groups.action.length + groups.waiting.length + groups.review.length },
                { label: "Completed", value: groups.closed.length },
                { label: "Avg rating", value: (() => { const a = averageRating(groups.all); return a ? `${a.avg.toFixed(1)}★` : "–"; })() },
              ]}
            />
            <button type="button" onClick={onSignOut} className="rounded-full bg-white px-3 py-1 font-semibold text-[#0e4f4f] hover:bg-slate-100">
              Sign out
            </button>
          </div>
        </div>
      </header>

      {storageWarning && (
        <p className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">{storageWarning}</p>
      )}

      <main className="mx-auto max-w-7xl px-4 py-6">
        {!ready ? (
          <p className="py-20 text-center text-slate-500">Loading ledger…</p>
        ) : (
          <>
            {/* stat tabs */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4" role="tablist">
              {FILTERS.map((f) => {
                const active = filter === f.key;
                return (
                  <button
                    key={f.key}
                    role="tab"
                    aria-selected={active}
                    type="button"
                    onClick={() => { setFilter(f.key); setSelectedId(null); }}
                    className={`rounded-2xl p-4 text-left ring-1 transition ${
                      active ? "bg-white shadow-md ring-2 ring-teal-600" : "bg-white/70 ring-slate-200 hover:bg-white"
                    }`}
                  >
                    <p className={`text-3xl font-bold tabular-nums ${f.accent}`}>{groups[f.key].length}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">{f.label}</p>
                    <p className="text-xs text-slate-500">{f.hint}</p>
                  </button>
                );
              })}
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[340px_1fr]">
              {/* queue */}
              <aside aria-label="Case queue" className="space-y-2">
                {list.length === 0 && (
                  <p className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">Nothing here right now.</p>
                )}
                {list.map((c) => {
                  const active = selected && selected.id === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedId(c.id)}
                      className={`w-full rounded-2xl p-4 text-left ring-1 transition ${
                        active ? "bg-teal-50 ring-2 ring-teal-600" : "bg-white ring-slate-200 hover:ring-teal-400"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-mono text-xs text-slate-500">#{c.id}</span>
                        <StatusBadge state={c.state} />
                      </div>
                      <p className="mt-1 font-semibold text-slate-900">{c.title}</p>
                      <p className="text-sm text-slate-600">{c.location}</p>
                      <p className="mt-2 text-xs font-medium text-slate-500">{queueMeta(c, now)}</p>
                      <div className="mt-2"><CaseTimer c={c} /></div>
                    </button>
                  );
                })}
                <MyRatingPanel cases={groups.all} onOpen={(id) => { setFilter("closed"); setSelectedId(id); }} />
              </aside>

              {/* detail */}
              <div>
                {selected ? (
                  <CaseDetail c={selected} now={now} onPropose={handlePropose} />
                ) : (
                  <p className="rounded-2xl bg-white p-10 text-center text-slate-500 ring-1 ring-slate-200">Select a case.</p>
                )}
              </div>
            </div>

            {/* ledger bar */}
            <footer className="mt-8 flex flex-wrap items-center gap-3 rounded-2xl bg-slate-900 px-5 py-4 text-sm text-slate-200">
              <p className="mr-auto">
                <span className="font-semibold text-white">Audit ledger</span> · {events.length} events · SHA-256 hash chain
              </p>
              {integrity && !integrity.checking && (
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${integrity.ok ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"}`}>
                  {integrity.ok ? `✓ ${integrity.count} events verified, chain intact` : `✗ Chain broken at event #${integrity.brokenAt}`}
                </span>
              )}
              <button type="button" onClick={handleVerify} className="rounded-lg bg-white px-3 py-1.5 font-semibold text-slate-900 hover:bg-slate-100">
                {integrity && integrity.checking ? "Verifying…" : "Verify integrity"}
              </button>
              <button type="button" onClick={handleReset} className={`rounded-lg px-3 py-1.5 ring-1 ${confirmReset ? "bg-rose-600 text-white ring-rose-600 hover:bg-rose-700" : "text-slate-300 ring-slate-600 hover:bg-slate-800"}`}>
                {confirmReset ? "Click again to reset all data" : "Reset demo"}
              </button>
            </footer>
          </>
        )}
      </main>

      <SiteFooter />

      {toast && (
        <div role="status" className={`fixed bottom-4 left-1/2 z-30 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-xl px-4 py-3 text-sm font-medium shadow-lg ${toast.ok ? "bg-emerald-700 text-white" : "bg-rose-700 text-white"}`}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

/* ---------------- officer's own resident rating (compact, under the case list) ---------------- */
function MyRatingPanel({ cases, onOpen }) {
  const [showAll, setShowAll] = useState(false);
  const rated = cases.filter((c) => c.rating).sort((a, b) => b.rating.at - a.rating.at);
  const avg = averageRating(cases);
  const dist = [5, 4, 3, 2, 1].map((n) => ({ n, count: rated.filter((c) => c.rating.stars === n).length }));
  const max = Math.max(1, ...dist.map((d) => d.count));
  const reviews = showAll ? rated : rated.slice(0, 1);

  return (
    <section aria-labelledby="my-rating-title" className="!mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-amber-200">
      <h2 id="my-rating-title" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your resident rating</h2>
      {avg ? (
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-2xl font-bold tabular-nums text-amber-600">{avg.avg.toFixed(1)}</span>
          <div>
            <StarRating value={Math.round(avg.avg * 10) / 10} size="h-3.5 w-3.5" showNumber={false} />
            <p className="text-[11px] text-slate-500">{avg.count} rating{avg.count > 1 ? "s" : ""}</p>
          </div>
        </div>
      ) : (
        <p className="mt-1.5 text-xs text-slate-500">No ratings yet. Residents rate your work when they confirm a fix.</p>
      )}

      {avg && (
        <div aria-label="Rating breakdown" className="mt-2 space-y-1">
          {dist.map((d) => (
            <div key={d.n} className="flex items-center gap-1.5 text-[11px]">
              <span className="w-6 shrink-0 tabular-nums text-slate-500">{d.n}★</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                <span className="block h-full rounded-full bg-amber-400" style={{ width: `${(d.count / max) * 100}%` }} />
              </span>
              <span className="w-3 shrink-0 text-right tabular-nums text-slate-500">{d.count}</span>
            </div>
          ))}
        </div>
      )}

      {reviews.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {reviews.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onOpen(c.id)} className="w-full rounded-lg bg-amber-50/70 px-2.5 py-1.5 text-left ring-1 ring-amber-100 hover:ring-amber-300">
                <div className="flex items-center gap-1.5">
                  <StarRating value={c.rating.stars} size="h-3 w-3" showNumber={false} />
                  <span className="truncate text-[11px] text-slate-500">#{c.id} · {c.title}</span>
                </div>
                {c.rating.comment && <p className="mt-0.5 line-clamp-2 text-xs italic text-slate-700">“{c.rating.comment}”</p>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {rated.length > 1 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 text-xs font-semibold text-teal-700 hover:underline">
          {showAll ? "Show less" : `See all ${rated.length} reviews`}
        </button>
      )}
    </section>
  );
}
