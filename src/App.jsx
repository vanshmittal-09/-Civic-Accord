// App.jsx — sign-in, resident sign-up, and role-based access for the three Civic Accord screens.
// Residents sign in with mobile number + PIN and can create their own account.
// Officer and supervisor accounts are fixed (issued by the municipality) and use a PIN.
// A signed-in user can only open their own screen; any other screen shows "Access denied".
// NOTE: this is client-side demo access control. Production needs server-side auth.
import { useState, useEffect } from "react";
import CitizenView from "./CitizenView";
import OfficerView from "./OfficerView";
import SupervisorView from "./SupervisorView";
import { Logo, SiteFooter, PhotoViewer } from "./shared";
import { registerResident, verifyResident, normalizeMobile, isValidMobile, isValidEmail, isValidPincode, DEMO_RESIDENT } from "./accounts";

const SESSION_KEY = "civicaccord_session_v2";

export const ACCOUNTS = {
  citizen:    { route: "citizen",    role: "CITIZEN",    label: "Resident's login",   blurb: "Report problems and verify the work" },
  officer:    { route: "officer",    role: "OFFICER",    label: "Officer's login",    blurb: "Resolve complaints with photo proof", personId: "damodar", name: "Officer Damodar",  pin: "2222" },
  supervisor: { route: "supervisor", role: "SUPERVISOR", label: "Supervisor's login", blurb: "Rule on disputed closures",            personId: "patel",   name: "Supervisor Patel", pin: "3333" },
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

const residentSession = (user) => ({
  route: "citizen", role: "CITIZEN", personId: user.id, personName: user.name, name: `Resident ${user.name}`,
  profile: user, // name, mobile, email, address (never the PIN)
});
const staffSession = (acct) => ({
  route: acct.route, role: acct.role, personId: acct.personId, personName: acct.name, name: acct.name,
});

export default function App() {
  const [session, setSession] = useState(loadSession);
  const [route, setRoute] = useState(readRoute);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function startSession(s) {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* ignore */ }
    setSession(s);
    setRoute(s.route);
    try { window.location.hash = `#${s.route}`; } catch { /* sandboxed preview */ }
  }

  function signOut() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    setSession(null);
    setRoute("");
    try { window.location.hash = ""; } catch { /* sandboxed preview */ }
  }

  if (!session) return <SignIn onSession={startSession} preselect={ACCOUNTS[route] ? route : null} />;

  // Each screen checks the role itself, so asking for someone else's screen
  // renders "Access denied", not their data.
  const View = VIEWS[route] || VIEWS[session.route];
  return (
    <>
      <View session={session} onSignOut={signOut} />
      <PhotoViewer />
    </>
  );
}

/* ---------------- shared bits ---------------- */
const ROLE_STYLE = {
  citizen:    { ring: "ring-[#3b2a7a]", bg: "bg-violet-50", chip: "bg-[#3b2a7a]", btn: "bg-[#3b2a7a] hover:bg-[#2e2061]" },
  officer:    { ring: "ring-[#0e4f4f]", bg: "bg-teal-50",   chip: "bg-[#0e4f4f]", btn: "bg-[#0e4f4f] hover:bg-[#0a3d3d]" },
  supervisor: { ring: "ring-[#1e3a5f]", bg: "bg-sky-50",    chip: "bg-[#1e3a5f]", btn: "bg-[#1e3a5f] hover:bg-[#162c48]" },
};
const svg = (paths) => (
  <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>
);
const ROLE_ICON = {
  citizen: svg(<><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-5h4v5" /></>),
  officer: svg(<><path d="M3 7h11v9H3z" /><path d="M14 10h4l3 3v3h-7" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></>),
  supervisor: svg(<><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>),
};
const inputCls =
  "mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/20 disabled:bg-slate-100";
const pinCls = `${inputCls} text-center font-mono text-xl tracking-[0.5em]`;
const digits = (v, n) => v.replace(/\D/g, "").slice(0, n);

function Brand() {
  return (
    <div className="mb-8 flex flex-col items-center text-center">
      <Logo className="mb-4 h-24 w-24 shadow-md ring-1 ring-slate-200" />
      <p className="text-4xl font-bold">Civic <span className="text-emerald-600">Accord</span></p>
      <p className="mt-2 text-slate-600">Transparent Systems. Stronger Communities.</p>
    </div>
  );
}

/* ---------------- sign in ---------------- */
function SignIn({ onSession, preselect }) {
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [choice, setChoice] = useState(preselect || "citizen");
  const [mobile, setMobile] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fails, setFails] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [, force] = useState(0);

  const locked = Date.now() < lockedUntil;
  useEffect(() => {
    if (!locked) return;
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [locked]);

  const isResident = choice === "citizen";
  const ready = pin.length === 4 && (!isResident || mobile.length === 10);

  function failed(msg) {
    const n = fails + 1;
    setFails(n);
    setPin("");
    if (n >= 3) {
      setLockedUntil(Date.now() + 30000);
      setFails(0);
      setError("Too many wrong attempts. Try again in 30 seconds.");
    } else {
      setError(`${msg} ${3 - n} ${3 - n === 1 ? "try" : "tries"} left.`);
    }
  }

  async function submit(e) {
    if (e) e.preventDefault();
    if (locked || busy || !ready) return;
    const acct = ACCOUNTS[choice];
    if (isResident) {
      setBusy(true);
      let user = null;
      try {
        user = await verifyResident(mobile, pin);
      } catch (err) {
        setBusy(false);
        setPin("");
        setError(err.message);
        return;
      }
      setBusy(false);
      if (user) { setFails(0); onSession(residentSession(user)); }
      else failed("Mobile number or PIN is incorrect.");
      return;
    }
    if (pin === acct.pin) { setFails(0); onSession(staffSession(acct)); }
    else failed(`Wrong PIN for ${acct.label}.`);
  }

  if (mode === "signup") {
    return (
      <SignUp
        onDone={(user) => onSession(residentSession(user))}
        onBack={() => { setMode("signin"); setChoice("citizen"); setError(""); }}
      />
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-100 text-slate-900">
      <div className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-4xl">
        <Brand />
        <form onSubmit={(e) => e.preventDefault()} className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="text-xl font-semibold">Choose your login</h1>
            <button type="button" onClick={() => setMode("signup")} className="text-sm font-semibold text-[#3b2a7a] underline-offset-4 hover:underline">
              New resident? Create an account
            </button>
          </div>

          <fieldset className="mt-5 grid grid-cols-3 gap-2 sm:gap-4">
            <legend className="sr-only">Choose your role</legend>
            {Object.values(ACCOUNTS).map((a) => {
              const st = ROLE_STYLE[a.route];
              const on = choice === a.route;
              return (
                <label key={a.route} className="block cursor-pointer">
                  <input
                    type="radio" name="role" value={a.route} className="peer sr-only"
                    checked={on}
                    onChange={() => { setChoice(a.route); setError(""); setPin(""); }}
                  />
                  <span
                    className={`relative flex h-full flex-col items-center gap-2 rounded-2xl px-2 py-4 text-center transition sm:gap-3 sm:px-5 sm:py-7 peer-focus-visible:ring-4 peer-focus-visible:ring-slate-300 ${
                      on ? `ring-2 ${st.ring} ${st.bg} shadow-md` : "ring-1 ring-slate-200 hover:shadow-sm hover:ring-slate-400"
                    }`}
                  >
                    {on && (
                      <span className={`absolute right-1.5 top-1.5 flex h-5 w-5 items-center sm:right-3 sm:top-3 sm:h-6 sm:w-6 justify-center rounded-full text-white ${st.chip}`}>
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
                      </span>
                    )}
                    <span className={`flex h-11 w-11 items-center justify-center rounded-xl text-white sm:h-16 sm:w-16 sm:rounded-2xl ${st.chip}`}>{ROLE_ICON[a.route]}</span>
                    <span className="block text-sm font-semibold leading-tight sm:text-lg">{a.label}</span>
                    <span className="hidden text-sm text-slate-500 sm:block">{a.blurb}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          <div className="mx-auto mt-8 max-w-sm">
            {isResident && (
              <div className="mb-4">
                <label htmlFor="mobile" className="block text-sm font-medium">Mobile number</label>
                <input
                  id="mobile" type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="10-digit mobile number"
                  value={mobile} disabled={locked}
                  onChange={(e) => { setMobile(digits(e.target.value, 10)); setError(""); }}
                  className={`${inputCls} font-mono tracking-wider`}
                />
              </div>
            )}
            <label htmlFor="pin" className="block text-sm font-medium">PIN for {ACCOUNTS[choice].label}</label>
            <input
              id="pin" type="password" inputMode="numeric" autoComplete="off" maxLength={4}
              value={pin} disabled={locked}
              onChange={(e) => { setPin(digits(e.target.value, 4)); setError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") submit(e); }}
              className={pinCls}
            />
            {(error || locked) && (
              <p role="alert" className="mt-2 text-sm text-rose-700">
                {locked ? `Too many wrong attempts. Try again in ${Math.ceil((lockedUntil - Date.now()) / 1000)}s.` : error}
              </p>
            )}
            <button
              type="button" onClick={submit} disabled={!ready || locked || busy}
              className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3.5 font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {busy ? "Checking…" : `Sign in to ${ACCOUNTS[choice].label}`}
            </button>
            {!isResident && (
              <p className="mt-3 text-center text-xs text-slate-500">Staff accounts are issued by the municipality.</p>
            )}
          </div>
        </form>
        <p className="mt-4 text-center text-xs text-slate-500">
          Demo logins: Resident {DEMO_RESIDENT.mobile} / PIN {DEMO_RESIDENT.pin} · Officer PIN 2222 · Supervisor PIN 3333
        </p>
      </div>
      </div>
      <SiteFooter />
    </div>
  );
}

/* ---------------- resident sign up ---------------- */
function SignUp({ onDone, onBack }) {
  const [f, setF] = useState({ name: "", mobile: "", email: "", address: "", city: "", pincode: "", pin: "", pin2: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (key, value) => { setF((x) => ({ ...x, [key]: value })); setError(""); };

  const m = normalizeMobile(f.mobile);
  const checks = {
    name: f.name.trim().length >= 2,
    mobile: isValidMobile(m),
    email: isValidEmail(f.email),
    address: f.address.trim().length >= 5,
    city: f.city.trim().length >= 2,
    pincode: isValidPincode(f.pincode),
    pin: /^\d{4}$/.test(f.pin),
    match: f.pin.length === 4 && f.pin === f.pin2,
  };
  const valid = Object.values(checks).every(Boolean);
  const missing = Object.keys(checks).filter((k) => !checks[k]).length;

  async function submit(e) {
    if (e) e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      const user = await registerResident({ ...f, mobile: m });
      onDone(user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const hint = (ok, text) => (
    <p className={`mt-1 text-xs ${ok ? "text-emerald-700" : "text-slate-500"}`}>{ok ? "✓ " : ""}{text}</p>
  );
  const bad = (text) => <p className="mt-1 text-xs text-rose-700">{text}</p>;

  return (
    <div className="flex min-h-screen flex-col bg-slate-100 text-slate-900">
      <div className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <Brand />
        <form onSubmit={(e) => e.preventDefault()} className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
          <div className="flex items-center gap-4">
            <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white ${ROLE_STYLE.citizen.chip}`}>{ROLE_ICON.citizen}</span>
            <div>
              <h1 className="text-xl font-semibold">Create a resident account</h1>
              <p className="text-sm text-slate-500">Report issues in your area and verify the work done.</p>
            </div>
          </div>

          <fieldset className="mt-6">
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your details</legend>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="su-name" className="block text-sm font-medium">Full name</label>
                <input id="su-name" autoComplete="name" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Asha Sharma" className={inputCls} />
              </div>
              <div>
                <label htmlFor="su-mobile" className="block text-sm font-medium">Mobile number</label>
                <input
                  id="su-mobile" type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="10-digit mobile number"
                  value={f.mobile} onChange={(e) => set("mobile", digits(e.target.value, 10))}
                  className={`${inputCls} font-mono tracking-wider`}
                />
                {f.mobile.length === 10 && !checks.mobile ? bad("Indian mobile numbers start with 6, 7, 8 or 9.") : hint(checks.mobile, "You'll use this to sign in.")}
              </div>
              <div>
                <label htmlFor="su-email" className="block text-sm font-medium">Gmail address</label>
                <input
                  id="su-email" type="email" inputMode="email" autoComplete="email" placeholder="name@gmail.com"
                  value={f.email} onChange={(e) => set("email", e.target.value.trim())}
                  className={inputCls}
                />
                {f.email.includes("@") && !checks.email ? bad("Enter a full email, like name@gmail.com.") : hint(checks.email, "For updates on your complaints.")}
              </div>
            </div>
          </fieldset>

          <fieldset className="mt-6">
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">Address</legend>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="su-address" className="block text-sm font-medium">House number, street, sector</label>
                <input id="su-address" autoComplete="street-address" value={f.address} onChange={(e) => set("address", e.target.value)} placeholder="e.g. House 42, Sector 14" className={inputCls} />
              </div>
              <div>
                <label htmlFor="su-city" className="block text-sm font-medium">City</label>
                <input id="su-city" autoComplete="address-level2" value={f.city} onChange={(e) => set("city", e.target.value)} placeholder="e.g. Faridabad" className={inputCls} />
              </div>
              <div>
                <label htmlFor="su-pincode" className="block text-sm font-medium">PIN code</label>
                <input
                  id="su-pincode" inputMode="numeric" autoComplete="postal-code" placeholder="6 digits"
                  value={f.pincode} onChange={(e) => set("pincode", digits(e.target.value, 6))}
                  className={`${inputCls} font-mono tracking-wider`}
                />
                {f.pincode.length === 6 && !checks.pincode ? bad("PIN codes don't start with 0.") : null}
              </div>
            </div>
          </fieldset>

          <fieldset className="mt-6">
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">Security</legend>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="su-pin" className="block text-sm font-medium">Create a 4-digit PIN</label>
                <input id="su-pin" type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} value={f.pin} onChange={(e) => set("pin", digits(e.target.value, 4))} className={pinCls} />
              </div>
              <div>
                <label htmlFor="su-pin2" className="block text-sm font-medium">Confirm PIN</label>
                <input
                  id="su-pin2" type="password" inputMode="numeric" autoComplete="new-password" maxLength={4}
                  value={f.pin2} onChange={(e) => set("pin2", digits(e.target.value, 4))}
                  onKeyDown={(e) => { if (e.key === "Enter") submit(e); }}
                  className={pinCls}
                />
              </div>
            </div>
            {f.pin2.length === 4 && !checks.match ? bad("PINs don't match.") : hint(checks.match, "Both PINs must match.")}
          </fieldset>

          {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-200">{error}</p>}

          <button
            type="button" onClick={submit} disabled={!valid || busy}
            className={`mt-6 w-full rounded-xl px-4 py-3.5 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 ${ROLE_STYLE.citizen.btn}`}
          >
            {busy ? "Creating account…" : valid ? "Create account and sign in" : `Create account (${missing} ${missing === 1 ? "field" : "fields"} left)`}
          </button>
          <p className="mt-4 text-center text-sm text-slate-600">
            Already registered?{" "}
            <button type="button" onClick={onBack} className="font-semibold text-[#3b2a7a] underline-offset-4 hover:underline">Sign in</button>
          </p>
          <p className="mt-2 text-center text-xs text-slate-500">Officer and supervisor accounts are issued by the municipality and can't be created here.</p>
        </form>
      </div>
      </div>
      <SiteFooter />
    </div>
  );
}
