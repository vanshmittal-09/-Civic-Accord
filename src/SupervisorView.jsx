// SupervisorView.jsx — Supervisor screen for Civic Accord (Supervisor Patel).
// Reviews disputes side by side (complaint · officer proof · citizen counter-proof)
// and issues a binding, reasoned ruling: Uphold (close) or Overturn (order rework).
import { useState, useMemo, useEffect } from "react";
import { STATES, CLOSED_STATES, AUTO_CLOSE_MS, PEOPLE, useCivicLedger, useNow, verifyLedger } from "./civicLedger";
import {
  dur, ago, stamp, StatusBadge, Icon, Card, ProofCard, Timeline, ComplaintPhotos,
  TopBar, AccessDenied, LedgerBar,
} from "./shared";

const MIN_RULING = 30;

const TABS = [
  { key: "disputes", label: "Disputes to rule", hint: "Contested by residents", accent: "text-rose-700", states: [STATES.CONTESTED] },
  { key: "rework", label: "Rework in progress", hint: "Overturned rulings", accent: "text-violet-700", states: [STATES.REWORK] },
  { key: "open", label: "Open cases", hint: "New + awaiting resident", accent: "text-sky-700", states: [STATES.SUBMITTED, STATES.PROPOSED] },
  { key: "closed", label: "Closed", hint: "All closures", accent: "text-emerald-700", states: CLOSED_STATES },
];

export default function SupervisorView({ session, onSignOut }) {
  if (!session || session.role !== "SUPERVISOR") {
    return <AccessDenied session={session} requiredLabel="Supervisors" onSignOut={onSignOut} />;
  }
  return <SupervisorScreen session={session} onSignOut={onSignOut} />;
}

function SupervisorScreen({ session, onSignOut }) {
  const me = PEOPLE[session.personId];
  const now = useNow();
  const { ready, events, cases, dispatch } = useCivicLedger(now);
  const [tab, setTab] = useState("disputes");
  const [selectedId, setSelectedId] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const groups = useMemo(() => {
    const g = {};
    for (const t of TABS) {
      g[t.key] = cases.filter((c) => t.states.includes(c.state)).sort((a, b) => a.updatedAt - b.updatedAt);
    }
    g.closed.reverse();
    return g;
  }, [cases]);

  const list = groups[tab];
  const selected = list.find((c) => c.id === selectedId) || list[0] || null;

  // officer accountability, computed from the ledger
  const officerStats = useMemo(() => {
    const byOfficer = {};
    const row = (id, name) => (byOfficer[id] ||= { id, name, proposals: 0, disputed: 0, overturned: 0, upheld: 0, confirmed: 0, uncontested: 0 });
    const officerOf = {};
    for (const e of events) {
      if (e.type === "SUBMIT") officerOf[e.caseId] = e.data.assignedTo;
      const oid = officerOf[e.caseId];
      const r = oid && row(oid, PEOPLE[oid] ? PEOPLE[oid].name : oid);
      if (!r) continue;
      if (e.type === "PROPOSE") r.proposals++;
      if (e.type === "DISPUTE") r.disputed++;
      if (e.type === "ORDER_REWORK") r.overturned++;
      if (e.type === "UPHOLD") r.upheld++;
      if (e.type === "CONFIRM") r.confirmed++;
      if (e.type === "AUTO_CLOSE") r.uncontested++;
    }
    return Object.values(byOfficer);
  }, [events]);

  async function rule(c, action, data) {
    try {
      await dispatch(c.id, action, me, data);
      setToast({
        ok: true,
        text: action === "UPHOLD" ? `Ruling recorded. Case #${c.id} closed.` : `Ruling recorded. Rework ordered on #${c.id}.`,
      });
      setSelectedId(null);
    } catch (err) {
      setToast({ ok: false, text: err.message });
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <TopBar subtitle="Supervisor console · Reasoned review of disputed closures" bg="bg-[#1e3a5f]" session={session} onSignOut={onSignOut} />

      <main className="mx-auto max-w-7xl px-4 py-6">
        {!ready ? (
          <p className="py-20 text-center text-slate-500">Loading…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4" role="tablist">
              {TABS.map((t) => {
                const active = tab === t.key;
                return (
                  <button
                    key={t.key}
                    role="tab"
                    aria-selected={active}
                    type="button"
                    onClick={() => { setTab(t.key); setSelectedId(null); }}
                    className={`rounded-2xl p-4 text-left ring-1 transition ${active ? "bg-white shadow-md ring-2 ring-[#1e3a5f]" : "bg-white/70 ring-slate-200 hover:bg-white"}`}
                  >
                    <p className={`text-3xl font-bold tabular-nums ${t.accent}`}>{groups[t.key].length}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">{t.label}</p>
                    <p className="text-xs text-slate-500">{t.hint}</p>
                  </button>
                );
              })}
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
              <aside className="space-y-2" aria-label="Case list">
                {list.length === 0 && (
                  <p className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">
                    {tab === "disputes" ? "No disputes waiting. All clear." : "Nothing here right now."}
                  </p>
                )}
                {list.map((c) => {
                  const active = selected && selected.id === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedId(c.id)}
                      className={`w-full rounded-2xl p-4 text-left ring-1 transition ${active ? "bg-sky-50 ring-2 ring-[#1e3a5f]" : "bg-white ring-slate-200 hover:ring-sky-400"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-mono text-xs text-slate-500">#{c.id}</span>
                        <StatusBadge state={c.state} />
                      </div>
                      <p className="mt-1 font-semibold">{c.title}</p>
                      <p className="text-sm text-slate-600">{c.location}</p>
                      <p className="mt-2 text-xs text-slate-500">
                        {c.state === STATES.CONTESTED ? `Disputed ${ago(c.disputedAt, now)} by ${c.citizenName}` : `Updated ${ago(c.updatedAt, now)}`}
                      </p>
                    </button>
                  );
                })}

                <OfficerTable rows={officerStats} />
              </aside>

              <div>
                {selected ? (
                  <CaseDetail key={selected.id + selected.events.length} c={selected} now={now} onRule={rule} />
                ) : (
                  <p className="rounded-2xl bg-white p-10 text-center text-slate-500 ring-1 ring-slate-200">Select a case.</p>
                )}
              </div>
            </div>

            <LedgerBar events={events} verify={verifyLedger} />
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

function OfficerTable({ rows }) {
  return (
    <Card className="!p-4">
      <h3 className="text-sm font-semibold">Officer accountability</h3>
      <p className="text-xs text-slate-500">Computed live from the audit ledger.</p>
      <div className="mt-3 space-y-3">
        {rows.map((r) => {
          const disputeRate = r.proposals ? Math.round((r.disputed / r.proposals) * 100) : 0;
          return (
            <div key={r.id}>
              <p className="text-sm font-medium">{r.name}</p>
              <dl className="mt-1 grid grid-cols-3 gap-1 text-center text-xs">
                <Stat label="Proposals" value={r.proposals} />
                <Stat label="Disputed" value={`${r.disputed} (${disputeRate}%)`} />
                <Stat label="Overturned" value={r.overturned} />
                <Stat label="Confirmed" value={r.confirmed} />
                <Stat label="Uncontested" value={r.uncontested} />
                <Stat label="Upheld" value={r.upheld} />
              </dl>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-50 px-1 py-1.5 ring-1 ring-slate-200">
      <dd className="font-semibold tabular-nums text-slate-900">{value}</dd>
      <dt className="text-[10px] text-slate-500">{label}</dt>
    </div>
  );
}

/* ---------------- case detail + ruling ---------------- */
function CaseDetail({ c, now, onRule }) {
  const contested = c.state === STATES.CONTESTED;
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs text-slate-500">CASE #{c.id} · {c.category}</p>
            <h2 className="mt-1 text-xl font-semibold">{c.title}</h2>
            <p className="mt-0.5 text-sm text-slate-600">{c.location} · Resident {c.citizenName} · Officer Damodar</p>
          </div>
          <StatusBadge state={c.state} />
        </div>
      </Card>

      {contested ? (
        <>
          <section>
            <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Evidence dossier</h3>
            <div className="grid gap-4 xl:grid-cols-3">
              <Card>
                <h4 className="text-sm font-semibold">1 · Original complaint</h4>
                <p className="text-xs text-slate-500">{c.citizenName} · {stamp(c.submittedAt)}</p>
                <div className="mt-3"><ComplaintPhotos c={c} /></div>
                <p className="mt-3 text-sm leading-relaxed text-slate-700">{c.description}</p>
              </Card>
              <ProofCard title="2 · Officer's proof" proof={c.proposal} at={c.proposedAt} />
              <ProofCard title="3 · Resident's counter-proof" proof={c.dispute} at={c.disputedAt} tone="citizen" />
            </div>
          </section>
          <RulingForm c={c} onRule={onRule} />
        </>
      ) : (
        <ReadOnlyPanel c={c} now={now} />
      )}

      <Timeline c={c} />
    </div>
  );
}

function RulingForm({ c, onRule }) {
  const [ruling, setRuling] = useState("");
  const [bulkTruck, setBulkTruck] = useState(false);
  const [busy, setBusy] = useState(null);
  const ok = ruling.trim().length >= MIN_RULING;

  async function submit(action) {
    if (!ok || busy) return;
    setBusy(action);
    await onRule(c, action, {
      ruling: ruling.trim(),
      outcome: action === "UPHOLD" ? "UPHELD" : "OVERTURNED",
      bulkTruckDispatched: bulkTruck,
    });
    setBusy(null);
  }

  return (
    <Card className="ring-2 ring-[#1e3a5f]/30">
      <h3 className="text-lg font-semibold">Reasoned ruling</h3>
      <p className="mt-1 text-sm text-slate-600">
        Your ruling is binding and permanently recorded in the audit ledger. Explain what the evidence shows.
      </p>
      <label htmlFor={`ruling-${c.id}`} className="mt-4 block text-sm font-medium">Reasoning</label>
      <textarea
        id={`ruling-${c.id}`}
        rows={4}
        value={ruling}
        onChange={(e) => setRuling(e.target.value)}
        placeholder="e.g. The officer's photo shows the bin emptied, but the resident's photo shows bulk cardboard still on the lawn. The complaint is only partly resolved."
        className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#1e3a5f] focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
      />
      <p className={`mt-1 text-xs ${ok ? "text-emerald-700" : "text-slate-500"}`}>{ruling.trim().length}/{MIN_RULING} characters minimum</p>

      <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" checked={bulkTruck} onChange={(e) => setBulkTruck(e.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-[#1e3a5f]" />
        Dispatch bulk pickup truck
      </label>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={!ok || !!busy}
          onClick={() => submit("ORDER_REWORK")}
          className="rounded-xl bg-violet-700 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {busy === "ORDER_REWORK" ? "Recording…" : "Overturn: order rework"}
        </button>
        <button
          type="button"
          disabled={!ok || !!busy}
          onClick={() => submit("UPHOLD")}
          className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {busy === "UPHOLD" ? "Recording…" : "Uphold officer: close case"}
        </button>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Overturn sends the case back to the officer for fresh proof. Uphold closes it as <span className="font-mono">REVIEWER_CLOSED</span>.
      </p>
    </Card>
  );
}

function ReadOnlyPanel({ c, now }) {
  const box = {
    [STATES.SUBMITTED]: ["bg-sky-50 ring-sky-200 text-sky-950", "Waiting for the officer's resolution proposal."],
    [STATES.PROPOSED]: ["bg-amber-50 ring-amber-200 text-amber-950", `Waiting for ${c.citizenName} to verify. Auto-closes in ${dur(c.proposedAt + AUTO_CLOSE_MS - now)}.`],
    [STATES.REWORK]: ["bg-violet-50 ring-violet-200 text-violet-950", c.ruling ? `Your ruling: ${c.ruling.ruling}` : "Rework ordered."],
  }[c.state] || ["bg-emerald-50 ring-emerald-200 text-emerald-950",
    c.state === STATES.REVIEWER_CLOSED && c.ruling ? `Closed by your ruling: ${c.ruling.ruling}`
      : c.state === STATES.CONFIRMED ? `${c.citizenName} confirmed the work.`
      : "Closed automatically: no resident response within 72 hours."];
  return (
    <>
      <section className={`rounded-2xl p-5 ring-1 ${box[0]}`}>
        <p className="text-sm">{box[1]}</p>
        {c.ruling && c.ruling.bulkTruckDispatched && <p className="mt-2 text-xs font-semibold">Bulk pickup truck dispatched.</p>}
        <p className="mt-2 text-xs opacity-70">Read-only. Supervisors only rule on contested cases.</p>
      </section>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h4 className="text-sm font-semibold">Original complaint</h4>
          <div className="mt-3 max-w-sm"><ComplaintPhotos c={c} /></div>
          <p className="mt-3 text-sm text-slate-700">{c.description}</p>
        </Card>
        <ProofCard title="Officer's proof" proof={c.proposal} at={c.proposedAt} />
      </div>
    </>
  );
}
