// App.jsx — sign-in + role-based access for the three Civic Accord screens.
// Each role signs in with its own PIN. A signed-in user can only open their own screen;
// opening another role's URL (e.g. #/supervisor as a citizen) shows "Access denied".
// NOTE: this is client-side demo access control. Production needs server-side auth.
import { useState, useEffect } from "react";
import CitizenView from "./CitizenView";
import OfficerView from "./OfficerView";
import SupervisorView from "./SupervisorView";

const SESSION_KEY = "civicaccord_session_v1";

export const ACCOUNTS = {
  citizen:    { route: "citizen",    personId: "riya",    name: "Citizen Riya",     label: "Resident's login",   role: "CITIZEN",    pin: "1111", blurb: "Report problems and verify the work" },
  officer:    { route: "officer",    personId: "damodar", name: "Officer Damodar",  label: "Officer's login",    role: "OFFICER",    pin: "2222", blurb: "Resolve complaints with photo proof" },
  supervisor: { route: "supervisor", personId: "patel",   name: "Supervisor Patel", label: "Supervisor's login", role: "SUPERVISOR", pin: "3333", blurb: "Rule on disputed closures" },
};

const VIEWS = { citizen: CitizenView, officer: OfficerView, supervisor: SupervisorView };

const readRoute = () => {
  try { return (window.location.hash.replace(/^#\/?/, "") || "").split("/")[0]; } catch { return ""; }
};

function loadSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    return s && ACCOUNTS[s.route] ? s : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [session, setSession] = useState(loadSession);
  const [route, setRoute] = useState(readRoute);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function signIn(account) {
    const { pin, blurb, label, ...publicInfo } = account; // never keep the PIN in the session
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(publicInfo)); } catch { /* ignore */ }
    setSession(publicInfo);
    setRoute(account.route);
    try { window.location.hash = `#/${account.route}`; } catch { /* sandboxed preview */ }
  }

  function signOut() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    setSession(null);
    setRoute("");
    try { window.location.hash = "#/"; } catch { /* sandboxed preview */ }
  }

  if (!session) return <SignIn onSignIn={signIn} preselect={ACCOUNTS[route] ? route : null} />;

  // Signed in: render the requested screen. Each screen checks the role itself,
  // so asking for someone else's screen renders "Access denied", not their data.
  const View = VIEWS[route] || VIEWS[session.route];
  return <View session={session} onSignOut={signOut} />;
}

/* ---------------- sign-in ---------------- */
function SignIn({ onSignIn, preselect }) {
  const [choice, setChoice] = useState(preselect || "citizen");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [fails, setFails] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [, force] = useState(0);

  const locked = Date.now() < lockedUntil;
  useEffect(() => {
    if (!locked) return;
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [locked]);

  function submit(e) {
    if (e) e.preventDefault();
    if (locked) return;
    const acct = ACCOUNTS[choice];
    if (pin === acct.pin) {
      setFails(0);
      onSignIn(acct);
      return;
    }
    const n = fails + 1;
    setFails(n);
    setPin("");
    if (n >= 3) {
      setLockedUntil(Date.now() + 30000);
      setFails(0);
      setError("Too many wrong PINs. Try again in 30 seconds.");
    } else {
      setError(`Wrong PIN for ${acct.label}. ${3 - n} ${3 - n === 1 ? "try" : "tries"} left.`);
    }
  }

  const tones = {
    citizen: "peer-checked:ring-[#3b2a7a] peer-checked:bg-violet-50",
    officer: "peer-checked:ring-[#0e4f4f] peer-checked:bg-teal-50",
    supervisor: "peer-checked:ring-[#1e3a5f] peer-checked:bg-sky-50",
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10 text-slate-900">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="text-3xl font-bold">Civic <span className="text-emerald-600">Accord</span></p>
          <p className="mt-1 text-sm text-slate-600">Transparent Systems. Stronger Communities.</p>
        </div>
        <form onSubmit={(e) => e.preventDefault()} className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h1 className="text-lg font-semibold">Sign in</h1>
          <fieldset className="mt-4 space-y-2">
            <legend className="sr-only">Choose your role</legend>
            {Object.values(ACCOUNTS).map((a) => (
              <label key={a.route} className="block cursor-pointer">
                <input
                  type="radio" name="role" value={a.route} className="peer sr-only"
                  checked={choice === a.route}
                  onChange={() => { setChoice(a.route); setError(""); setPin(""); }}
                />
                <span className={`block rounded-xl px-4 py-3 ring-1 ring-slate-200 transition peer-checked:ring-2 peer-focus-visible:ring-2 peer-focus-visible:ring-slate-400 ${tones[a.route]}`}>
                  <span className="block font-semibold">{a.label}</span>
                  <span className="block text-xs text-slate-500">{a.blurb}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <label htmlFor="pin" className="mt-5 block text-sm font-medium">PIN</label>
          <input
            id="pin" type="password" inputMode="numeric" autoComplete="off" maxLength={4}
            value={pin} disabled={locked}
            onChange={(e) => { setPin(e.target.value.replace(/\D/g, "")); setError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter" && pin.length === 4) submit(e); }}
            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-center font-mono text-lg tracking-[0.5em] focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/20 disabled:bg-slate-100"
          />
          {(error || locked) && (
            <p role="alert" className="mt-2 text-sm text-rose-700">
              {locked ? `Too many wrong PINs. Try again in ${Math.ceil((lockedUntil - Date.now()) / 1000)}s.` : error}
            </p>
          )}
          <button
            type="button" onClick={submit} disabled={pin.length !== 4 || locked}
            className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            Sign in to {ACCOUNTS[choice].label}
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-slate-500">
          Demo PINs: Resident 1111 · Officer 2222 · Supervisor 3333
        </p>
      </div>
    </div>
  );
}
