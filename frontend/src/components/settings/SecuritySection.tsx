import { useState } from "react";
import type { FormEvent } from "react";
import Toggle from "../ui/Toggle";
import { ApiError } from "../../lib/api";
import type { Mfa } from "../../lib/user/account";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, changePassword, setMfa, useAccount } from "../../lib/user/account";

// Account: who is signed in, second factor, password change and sign-out. Sign-in belongs to
// Authelia (see the README): the password here is the same one used on its page.
function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const tooShort = next !== "" && next.length < PASSWORD_MIN_LENGTH;
  const mismatch = again !== "" && again !== next;
  const ready = current !== "" && next.length >= PASSWORD_MIN_LENGTH && next.length <= PASSWORD_MAX_LENGTH && next === again;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setAgain("");
      setMessage({ text: "Password changed. Use it the next time you sign in.", error: false });
    } catch (err) {
      setMessage({ text: err instanceof ApiError ? err.message : "Something went wrong.", error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="pwform" onSubmit={submit}>
      <div className="pwform__field">
        <label htmlFor="pw-current">Current password</label>
        <input
          id="pw-current"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          maxLength={256}
        />
      </div>
      <div className="pwform__field">
        <label htmlFor="pw-new">New password</label>
        <input
          id="pw-new"
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          maxLength={256}
          aria-invalid={tooShort}
          aria-describedby="pw-new-hint"
        />
        <p id="pw-new-hint" className={`pwform__hint ${tooShort ? "is-error" : "muted"}`}>
          {PASSWORD_MIN_LENGTH} to {PASSWORD_MAX_LENGTH} characters.
        </p>
      </div>
      <div className="pwform__field">
        <label htmlFor="pw-again">Repeat the new password</label>
        <input
          id="pw-again"
          type="password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          autoComplete="new-password"
          maxLength={256}
          aria-invalid={mismatch}
          aria-describedby={mismatch ? "pw-again-error" : undefined}
        />
        {mismatch && (
          <p id="pw-again-error" className="pwform__hint is-error" role="alert">The two passwords do not match.</p>
        )}
      </div>
      <div className="keyrow__actions">
        <button type="submit" className="btn btn--solid btn--compact" disabled={!ready || busy}>
          Change password
        </button>
        <span className={`keyrow__message mono ${message?.error ? "is-error" : ""}`} role={message?.error ? "alert" : "status"}>
          {message?.text}
        </span>
      </div>
    </form>
  );
}

type MfaStep = "idle" | "turn-on" | "turn-off";

// Second factor: off by default, each user turns it on for themselves. The device (TOTP app
// or security key) is registered by Authelia in its portal, not by Argus.
function MfaToggle({ initial }: { initial: Mfa }) {
  const [mfa, setMfaState] = useState<Mfa>(initial);
  const [step, setStep] = useState<MfaStep>("idle");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const fail = (err: unknown) => setMessage({ text: err instanceof ApiError ? err.message : "Something went wrong.", error: true });

  function ask(turnOn: boolean) {
    setMessage(null);
    setPassword("");
    setStep(turnOn ? "turn-on" : "turn-off");
  }

  function cancel() {
    setStep("idle");
    setPassword("");
    setMessage(null);
  }

  async function turnOn() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      setMfaState(await setMfa(true));
      setStep("idle");
      setMessage({ text: "Two-factor authentication is on. Taking you to the sign-in page to register a device…", error: false });
      // From now on Authelia asks for the second factor: on reload, nginx takes the user to its portal
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      fail(err);
      setBusy(false);
    }
  }

  async function turnOff(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || password === "") return;
    setBusy(true);
    setMessage(null);
    try {
      setMfaState(await setMfa(false, password));
      setStep("idle");
      setPassword("");
      setMessage({ text: "Two-factor authentication is off. The devices you registered stay in the sign-in portal until you remove them.", error: false });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ul className="pref-list">
        <li className="pref">
          <div className="pref__text">
            <span id="mfa-name" className="pref__name">Ask for a second step when signing in</span>
            <span className="pref__covers muted">
              After your password, the sign-in page asks for a code from an authenticator app, or for a security key. Off by default.
            </span>
            {mfa.required && (
              <span className="pref__covers muted">This server requires it for every user, so it cannot be turned off here.</span>
            )}
          </div>
          <Toggle
            checked={mfa.enabled}
            onChange={ask}
            label="Require two-factor authentication"
            disabled={mfa.required || busy}
          />
        </li>
      </ul>

      {step === "turn-on" && (
        <div className="mfa-panel" role="group" aria-labelledby="mfa-on-title">
          <p id="mfa-on-title" className="mfa-panel__title">Turn on two-factor authentication?</p>
          <p className="muted">
            You will be taken to the sign-in page to register a device. It first asks for a one-time code. Unless a mail server is set up,
            that code is written to <span className="mono">data/authelia/notification.txt</span> on the server: ask whoever runs
            Argus if that is not you. Then scan the QR code with an authenticator app.
          </p>
          <div className="keyrow__actions">
            <button type="button" className="btn btn--solid btn--compact" onClick={turnOn} disabled={busy}>
              Turn on and continue
            </button>
            <button type="button" className="btn btn--ghost btn--compact" onClick={cancel} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === "turn-off" && (
        <form className="mfa-panel" onSubmit={turnOff} aria-labelledby="mfa-off-title">
          <p id="mfa-off-title" className="mfa-panel__title">Turn off two-factor authentication?</p>
          <div className="pwform__field">
            <label htmlFor="mfa-password">Your password, to confirm</label>
            <input
              id="mfa-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              maxLength={256}
              autoFocus
            />
          </div>
          <div className="keyrow__actions">
            <button type="submit" className="btn btn--solid btn--compact" disabled={busy || password === ""}>
              Turn off
            </button>
            <button type="button" className="btn btn--ghost btn--compact" onClick={cancel} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {message && (
        <p className={`keyrow__message mono mfa-message ${message.error ? "is-error" : ""}`} role={message.error ? "alert" : "status"}>
          {message.text}
        </p>
      )}

      {mfa.enabled && mfa.manageUrl && step === "idle" && (
        <p className="account__signout">
          <a className="btn btn--ghost btn--compact" href={mfa.manageUrl}>Manage devices</a>
        </p>
      )}
    </>
  );
}

export default function SecuritySection() {
  const account = useAccount();

  return (
    <>
      <p className="settings__lead muted">
        You sign in through the Argus login page. Your API keys and password belong to this account.
      </p>

      <section className="pref-group" aria-labelledby="sec-account">
        <h3 id="sec-account">Account</h3>
        {account ? (
          <dl className="account">
            <div>
              <dt>Signed in as</dt>
              <dd className="mono">{account.username}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd className="mono">{account.email}</dd>
            </div>
          </dl>
        ) : (
          <p className="muted" role="status">Loading…</p>
        )}
        {account?.logoutUrl && (
          <p className="account__signout">
            <a className="btn btn--ghost btn--compact" href={account.logoutUrl}>Sign out</a>
          </p>
        )}
      </section>

      <section className="pref-group" aria-labelledby="sec-mfa">
        <h3 id="sec-mfa">Two-factor authentication</h3>
        {account ? <MfaToggle initial={account.mfa} /> : <p className="muted" role="status">Loading…</p>}
      </section>

      <section className="pref-group" aria-labelledby="sec-password">
        <h3 id="sec-password">Change password</h3>
        <PasswordForm />
      </section>
    </>
  );
}
