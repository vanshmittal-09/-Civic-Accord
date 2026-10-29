// CitizenView.jsx — Resident screen for Civic Accord (Citizen Riya).
// Residents report problems, then verify the officer's proof: Confirm Closure or Dispute with counter-photos.
// A resident only ever sees their own complaints.
import { useState, useMemo, useEffect } from "react";
import { STATES, CLOSED_STATES, AUTO_CLOSE_MS, PEOPLE, useCivicLedger, useNow } from "./civicLedger";
import {
  dur, ago, stamp, StatusBadge, Icon, Card, ProofCard, Timeline, ComplaintPhotos,
  PhotoPicker, TopBar, AccessDenied,
} from "./shared";

const CATEGORIES = [
  "Missed garbage collection",
  "Overflowing bin",
  "Illegal dumping",
  "Construction debris",
  "Broken or missing bin",
  "Dead animal",
  "Other sanitation issue",
];

// plain-language status for residents
const RESIDENT_LABEL = {
  [STATES.SUBMITTED]: "Sent to officer",
  [STATES.PROPOSED]: "Please verify",
  [STATES.CONTESTED]: "Supervisor reviewing",
  [STATES.REWORK]: "Rework ordered",
  [STATES.CONFIRMED]: "Resolved · You confirmed",
  [STATES.UNCONTESTED]: "Closed · No response",
  [STATES.REVIEWER_CLOSED]: "Closed by supervisor",
};

export default function CitizenView({ session, onSignOut }) {
  if (!session || session.role !== "CITIZEN") {
    return <AccessDenied session={session} requiredLabel="Residents" onSignOut={onSignOut} />;
  }
  return <CitizenScreen session={session} onSignOut={onSignOut} />;
}

function CitizenScreen({ session, onSignOut }) {
  const me = PEOPLE[session.personId];
  const now = useNow();
  const { ready, cases, dispatch } = useCivicLedger(now);
  const [selectedId, setSelectedId] = useState(null);
  const [mode, setMode] = useState("view"); // "view" | "report"
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  // only this resident's cases — nothing else is ever rendered
  const mine = useMemo(() => {
    const rank = (c) => (c.state === STATES.PROPOSED ? 0 : CLOSED_STATES.includes(c.state) ? 2 : 1);
    return cases
      .filter((c) => c.citizenId === me.id)
      .sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt);
  }, [cases, me.id]);

  const needsAction = mine.filter((c) => c.state === STATES.PROPOSED);
  const selected = mine.find((c) => c.id === selectedId) || mine[0] || null;

  async function act(caseId, action, data, okText) {
    try {
      await dispatch(caseId, action, me, data);
      setToast({ ok: true, text: okText });
      return true;
    } catch (err) {
      setToast({ ok: false, text: err.message });
      return false;
    }
  }

  async function submitReport(form) {
    const nextId = String(Math.max(1000, ...cases.map((c) => Number(c.id) || 0)) + 1);
    const ok = await act(
      nextId,
      "SUBMIT",
      {
        title: form.category,
        category: "Waste collection",
        location: form.location,
        description: form.description,
        photos: form.photos.map(({ src, capturedAt }) => ({ src, capturedAt })),
        photoLabel: "Resident photo",
        assignedTo: PEOPLE.damodar.id,
      },
      `Complaint #${nextId} submitted. Officer Damodar has been assigned.`
    );
    if (ok) { setMode("view"); setSelectedId(nextId); }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <TopBar subtitle="Resident portal · Report and verify civic work" bg="bg-[#3b2a7a]" session={session} onSignOut={onSignOut} />

      <main className="mx-auto max-w-6xl px-4 py-6">
        {!ready ? (
          <p className="py-20 text-center text-slate-500">Loading…</p>
        ) : (
          <>
            {needsAction.length > 0 && mode === "view" && (
              <button
                type="button"
                onClick={() => setSelectedId(needsAction[0].id)}
                className="mb-6 flex w-full items-center gap-3 rounded-2xl bg-amber-100 px-5 py-4 text-left ring-1 ring-amber-300 hover:bg-amber-200/70"
              >
                <span className="text-amber-900">{Icon.clock}</span>
                <span className="text-sm text-amber-950">
                  <b>{needsAction.length === 1 ? "1 resolution needs" : `${needsAction.length} resolutions need`} your verification.</b>{" "}
                  Check the work and confirm or dispute it.
                </span>
              </button>
            )}

            <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
              <aside className="space-y-3" aria-label="My complaints">
                <button
                  type="button"
                  onClick={() => setMode("report")}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#3b2a7a] px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#2e2061]"
                >
                  + Report a problem
                </button>
                <h2 className="px-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">My complaints ({mine.length})</h2>
                {mine.length === 0 && (
                  <p className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">No complaints yet.</p>
                )}
                {mine.map((c) => {
                  const active = mode === "view" && selected && selected.id === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { setMode("view"); setSelectedId(c.id); }}
                      className={`w-full rounded-2xl p-4 text-left ring-1 transition ${active ? "bg-violet-50 ring-2 ring-violet-600" : "bg-white ring-slate-200 hover:ring-violet-400"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-mono text-xs text-slate-500">#{c.id}</span>
                        <StatusBadge state={c.state} label={RESIDENT_LABEL[c.state]} />
                      </div>
                      <p className="mt-1 font-semibold">{c.title}</p>
                      <p className="text-sm text-slate-600">{c.location}</p>
                      <p className="mt-2 text-xs text-slate-500">Reported {ago(c.submittedAt, now)}</p>
                    </button>
                  );
                })}
              </aside>

              <div>
                {mode === "report" ? (
                  <ReportForm onCancel={() => setMode("view")} onSubmit={submitReport} />
                ) : selected ? (
                  <CaseDetail key={selected.id} c={selected} now={now} act={act} />
                ) : (
                  <p className="rounded-2xl bg-white p-10 text-center text-slate-500 ring-1 ring-slate-200">Report a problem to get started.</p>
                )}
              </div>
            </div>
          </>
        )}
      </main>

      {toast && (
        <div role="status" className={`fixed bottom-4 left-1/2 z-30 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${toast.ok ? "bg-emerald-700" : "bg-rose-700"}`}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

/* ---------------- report a problem ---------------- */
function ReportForm({ onSubmit, onCancel }) {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const valid = location.trim().length >= 3 && description.trim().length >= 15 && photos.length > 0;

  async function submit(e) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    await onSubmit({ category, location: location.trim(), description: description.trim(), photos });
    setBusy(false);
  }

  const field = "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-violet-600 focus:outline-none focus:ring-2 focus:ring-violet-500/30";
  return (
    <Card>
      <form onSubmit={(e) => e.preventDefault()} className="space-y-5">
        <div>
          <h2 className="text-xl font-semibold">Report a problem</h2>
          <p className="mt-1 text-sm text-slate-600">Your complaint goes to the field officer. You'll be asked to verify the work before it can be closed.</p>
        </div>
        <div>
          <label htmlFor="cat" className="mb-1.5 block text-sm font-medium">What's the problem?</label>
          <select id="cat" value={category} onChange={(e) => setCategory(e.target.value)} className={field}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="loc" className="mb-1.5 block text-sm font-medium">Where?</label>
          <input id="loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Sector 14 Park, near Gate 2" className={field} />
        </div>
        <div>
          <label htmlFor="desc" className="mb-1.5 block text-sm font-medium">Describe it</label>
          <textarea id="desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's wrong and for how long?" className={field} />
          <p className="mt-1 text-xs text-slate-500">{description.trim().length}/15 characters minimum</p>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">Photos <span className="font-normal text-slate-500">(at least 1, up to 4)</span></p>
          <PhotoPicker photos={photos} onChange={setPhotos} prompt="Take a photo of the problem" tone="violet" />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <button type="button" onClick={submit} disabled={!valid || busy} className="flex-1 rounded-xl bg-[#3b2a7a] px-4 py-3 text-sm font-semibold text-white hover:bg-[#2e2061] disabled:cursor-not-allowed disabled:bg-slate-300">
            {busy ? "Submitting…" : "Submit complaint"}
          </button>
          <button type="button" onClick={onCancel} className="rounded-xl px-4 py-3 text-sm font-medium text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">Cancel</button>
        </div>
      </form>
    </Card>
  );
}

/* ---------------- case detail ---------------- */
function CaseDetail({ c, now, act }) {
  const [disputing, setDisputing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  let panel = null;
  if (c.state === STATES.SUBMITTED) {
    panel = (
      <section className="rounded-2xl bg-sky-50 p-5 ring-1 ring-sky-200">
        <h3 className="font-semibold text-sky-950">Officer Damodar has been assigned</h3>
        <p className="mt-1 text-sm text-sky-900/80">When the work is done, you'll see their photo proof here and can confirm or dispute it. The officer can't close your complaint on their own.</p>
      </section>
    );
  } else if (c.state === STATES.PROPOSED) {
    const remaining = c.proposedAt + AUTO_CLOSE_MS - now;
    panel = (
      <>
        <section className="rounded-2xl bg-amber-50 p-5 ring-1 ring-amber-200">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-md">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-amber-950">{Icon.clock}Is it fixed?</h3>
              <p className="mt-1 text-sm text-amber-900/80">Officer Damodar says the work is done. Check the location and the proof below, then respond. If you don't respond, it closes as “Uncontested”.</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-amber-800">Time to respond</p>
              <p className="text-2xl font-bold tabular-nums text-amber-950">{dur(remaining)}</p>
            </div>
          </div>
        </section>
        <ProofCard title="Officer's proof" proof={c.proposal} at={c.proposedAt} />
        {!disputing ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              disabled={confirming}
              onClick={async () => { setConfirming(true); await act(c.id, "CONFIRM", { note: "Confirmed by resident" }, `Thank you. Complaint #${c.id} is closed.`); setConfirming(false); }}
              className="rounded-xl bg-emerald-700 px-4 py-3.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:bg-slate-300"
            >
              ✓ Yes, it's fixed: confirm closure
            </button>
            <button type="button" onClick={() => setDisputing(true)} className="rounded-xl bg-white px-4 py-3.5 text-sm font-semibold text-rose-700 ring-2 ring-rose-300 hover:bg-rose-50">
              ✗ Not fixed: dispute
            </button>
          </div>
        ) : (
          <DisputeForm
            onCancel={() => setDisputing(false)}
            onSubmit={(d) => act(c.id, "DISPUTE", d, `Dispute sent. Supervisor Patel will review #${c.id}.`)}
          />
        )}
      </>
    );
  } else if (c.state === STATES.CONTESTED) {
    panel = (
      <>
        <section className="rounded-2xl bg-rose-50 p-5 ring-1 ring-rose-200">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-rose-900">{Icon.lock}Your dispute is with Supervisor Patel</h3>
          <p className="mt-1 text-sm text-rose-900/80">The supervisor will compare the officer's proof with yours and give a written ruling. The officer can't close this case.</p>
        </section>
        <div className="grid gap-4 md:grid-cols-2">
          <ProofCard title="Officer's proof" proof={c.proposal} at={c.proposedAt} />
          <ProofCard title="Your counter-proof" proof={c.dispute} at={c.disputedAt} tone="citizen" />
        </div>
      </>
    );
  } else if (c.state === STATES.REWORK) {
    panel = (
      <section className="rounded-2xl bg-violet-50 p-5 ring-1 ring-violet-200">
        <h3 className="text-lg font-semibold text-violet-900">The supervisor ruled in your favour</h3>
        <p className="mt-1 text-sm leading-relaxed text-violet-900/85">{c.ruling.ruling}</p>
        <p className="mt-2 text-xs text-violet-900/60">The officer has been ordered to redo the work. You'll verify it again.</p>
      </section>
    );
  } else {
    const text = {
      [STATES.CONFIRMED]: "You confirmed the work. This complaint is resolved.",
      [STATES.UNCONTESTED]: "Closed automatically because there was no response within 72 hours.",
      [STATES.REVIEWER_CLOSED]: c.ruling ? `Supervisor ruling: ${c.ruling.ruling}` : "Closed by supervisor ruling.",
    }[c.state];
    panel = (
      <>
        <section className="rounded-2xl bg-emerald-50 p-5 ring-1 ring-emerald-200">
          <h3 className="text-lg font-semibold text-emerald-900">{RESIDENT_LABEL[c.state]}</h3>
          <p className="mt-1 text-sm text-emerald-900/80">{text}</p>
        </section>
        <ProofCard title="Officer's proof" proof={c.proposal} at={c.proposedAt} />
      </>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs text-slate-500">COMPLAINT #{c.id}</p>
            <h2 className="mt-1 text-xl font-semibold">{c.title}</h2>
            <p className="mt-0.5 text-sm text-slate-600">{c.location}</p>
          </div>
          <StatusBadge state={c.state} label={RESIDENT_LABEL[c.state]} />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-[200px_1fr]">
          <ComplaintPhotos c={c} />
          <div>
            <p className="text-xs text-slate-500">You reported this · {stamp(c.submittedAt)}</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">{c.description}</p>
          </div>
        </div>
      </Card>
      {panel}
      <Timeline c={c} />
    </div>
  );
}

function DisputeForm({ onSubmit, onCancel }) {
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const valid = note.trim().length >= 20 && photos.length > 0;

  async function submit(e) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    await onSubmit({
      note: note.trim(),
      photos: photos.map(({ src, capturedAt }) => ({ src, capturedAt })),
      photoLabel: "Resident counter-proof",
      metadataStripped: true,
    });
    setBusy(false);
  }

  return (
    <Card className="ring-2 ring-rose-200">
      <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-rose-900">Dispute this resolution</h3>
          <p className="mt-1 text-sm text-slate-600">Show what's still wrong. Your photos and the officer's proof go side by side to Supervisor Patel.</p>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">Counter-proof photos <span className="font-normal text-slate-500">(at least 1)</span></p>
          <PhotoPicker photos={photos} onChange={setPhotos} prompt="Photograph what's still wrong" tone="rose" />
        </div>
        <div>
          <label htmlFor="dnote" className="mb-1.5 block text-sm font-medium">What's not fixed?</label>
          <textarea
            id="dnote" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Bin is empty but bulk cardboard was left on the lawn."
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/30"
          />
          <p className="mt-1 text-xs text-slate-500">{note.trim().length}/20 characters minimum</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <button type="button" onClick={submit} disabled={!valid || busy} className="flex-1 rounded-xl bg-rose-700 px-4 py-3 text-sm font-semibold text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:bg-slate-300">
            {busy ? "Sending…" : "Send dispute to supervisor"}
          </button>
          <button type="button" onClick={onCancel} className="rounded-xl px-4 py-3 text-sm font-medium text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">Back</button>
        </div>
      </form>
    </Card>
  );
}
