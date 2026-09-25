import { useState } from "react";
import { USE_MOCK_API, STORAGE_KEYS } from "../api/config.js";
import { login, signUp, confirmSignUp, resendConfirmationCode } from "../api/cognito.js";
import { authMessage } from "../api/errors.js";

const DEMO_USERS = [
  { role: "attendee", name: "Asha", label: "👤 Attendee", desc: "QR pass, queues, booth waits" },
  { role: "organizer", name: "Organizer", label: "🛠 Organizer", desc: "Live dashboard, queues, emergency" },
  { role: "sponsor", name: "AWS", label: "🏢 Sponsor", desc: "Visitors, wait time, swag stock" },
];

export default function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState("login"); // login | signup | confirm
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [notice, setNotice] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    setNotice(null);
    if (USE_MOCK_API) return enterDemo("attendee", name || "Demo User");
    setBusy(true);
    try {
      if (mode === "signup") {
        await signUp(email, password, name);
        setNotice("Account created — we emailed you a 6-digit code. Enter it below.");
        setMode("confirm");
        return;
      }
      if (mode === "confirm") {
        await confirmSignUp(email, code.trim());
        // Confirmed → straight into the app, no second typing round.
        await login(email, password);
        const sess = JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSION));
        enterDemo("attendee", sess.email);
        return;
      }
      await login(email, password);
      const sess = JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSION));
      enterDemo("attendee", sess.email);
    } catch (e2) {
      // Unconfirmed account trying to sign in → take them to the code screen.
      if (/UserNotConfirmed/i.test(e2?.code || "")) {
        setMode("confirm");
        setNotice("We need to confirm your email first — enter the code we sent.");
      }
      // Expired code while confirming → offer resend right there.
      if (mode === "confirm" && /ExpiredCode/i.test(e2?.code || "")) {
        try { await resendConfirmationCode(email); } catch { /* best effort */ }
      }
      setErr(e2);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setErr(null);
    setBusy(true);
    try {
      await resendConfirmationCode(email);
      setNotice("New code sent — check your email.");
    } catch (e2) {
      setErr(e2);
    } finally {
      setBusy(false);
    }
  };

  function enterDemo(role, nm) {
    localStorage.setItem(STORAGE_KEYS.NAME, nm);
    localStorage.setItem(STORAGE_KEYS.USER_ID, `u_${role.slice(0, 2)}demo`);
    onLogin({ role, name: nm });
  }

  const title =
    mode === "signup" ? "Create account" :
    mode === "confirm" ? "Confirm your email" : "Sign in";

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <div className="text-center">
        <div className="mb-2 text-5xl">🎫</div>
        <h1 className="text-3xl font-bold tracking-tight">
          Event<span className="text-orange-500">Flow</span>
        </h1>
        <p className="mt-1 text-sm text-slate-400">Smart crowd & queue management, powered by AWS</p>
      </div>

      {USE_MOCK_API && (
        <div className="card">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Demo mode — pick a role
          </p>
          <div className="flex flex-col gap-2">
            {DEMO_USERS.map((d) => (
              <button
                key={d.role}
                onClick={() => enterDemo(d.role, d.name)}
                className="btn-ghost justify-start text-left"
              >
                <span className="text-xl">{d.label.split(" ")[0]}</span>
                <span className="flex flex-col items-start">
                  <span className="font-semibold capitalize">{d.role}</span>
                  <span className="text-xs text-slate-400">{d.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <form className="card flex flex-col gap-3" onSubmit={submit}>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          {USE_MOCK_API ? "Or sign in (live Cognito once connected)" : title}
        </p>
        {mode === "signup" && (
          <input className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        )}
        {mode === "confirm" ? (
          <input
            className="input tracking-[0.4em] text-center text-lg"
            placeholder="6-digit code"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        ) : (
          <>
            <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input className="input" type="password" placeholder="Password (8+ chars)" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </>
        )}
        <button className="btn-primary" disabled={busy}>
          {busy ? "Please wait…" :
            mode === "signup" ? "Sign up" :
            mode === "confirm" ? "Confirm & enter" : "Sign in"}
        </button>
        {mode === "confirm" && (
          <button type="button" className="text-xs text-slate-400 hover:text-slate-200" onClick={resend} disabled={busy}>
            Didn't get the code? Resend
          </button>
        )}
        {mode !== "confirm" && (
          <button
            type="button"
            className="text-xs text-slate-400 hover:text-slate-200"
            onClick={() => { setMode(mode === "login" ? "signup" : "login"); setErr(null); setNotice(null); }}
          >
            {mode === "login" ? "New here? Create an account" : "Have an account? Sign in"}
          </button>
        )}
        {err && <p className="text-sm text-rose-400">⚠️ {authMessage(err)}</p>}
        {notice && <p className="text-sm text-emerald-400">{notice}</p>}
      </form>
    </div>
  );
}
