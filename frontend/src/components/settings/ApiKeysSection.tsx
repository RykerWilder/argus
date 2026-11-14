import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Bracket } from "../layout/Header";
import { fetchKeyStatuses, removeApiKey, saveApiKey } from "../../lib/user/account";
import type { KeyStatus, KeyStatuses } from "../../lib/user/account";
import { API_KEY_PATTERN, API_KEY_SERVICES } from "../../lib/user/settings";
import type { ApiKeyService } from "../../lib/user/settings";
import { ApiError } from "../../lib/api";

// Required keys first, then optional ones; otherwise the order of API_KEY_SERVICES is kept.
const ORDERED_SERVICES = [...API_KEY_SERVICES].sort((a, b) => Number(b.required) - Number(a.required));

interface KeyRowProps {
  service: ApiKeyService;
  status: KeyStatus;
  onStatus: (status: KeyStatus) => void;
}

function KeyRow({ service, status, onStatus }: KeyRowProps) {
  // The saved key never comes back to the browser (only the last 4 characters): the
  // field is for entering a new one, which replaces the old one.
  const [draft, setDraft] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const value = draft.trim();
  const valid = value === "" || API_KEY_PATTERN.test(value);
  const inputId = `key-${service.id}`;

  async function run(action: () => Promise<KeyStatus>, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      onStatus(await action());
      setDraft("");
      setShown(false);
      setMessage({ text: done, error: false });
    } catch (err) {
      setMessage({ text: err instanceof ApiError ? err.message : "Something went wrong.", error: true });
    } finally {
      setBusy(false);
    }
  }

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!valid || !value || busy) return;
    void run(() => saveApiKey(service.id, value), "Saved.");
  }

  return (
    <li className="keyrow">
      <form onSubmit={save}>
        <div className="keyrow__head">
          <label htmlFor={inputId} className="keyrow__name">{service.name}</label>
          <span className="keyrow__tag mono">{service.required ? "Required" : "Optional"}</span>
          <span className={`keyrow__state mono ${status.configured ? "is-set" : ""}`}>
            {status.configured ? `Saved · ends with ${status.hint ?? "????"}` : "Not set"}
          </span>
        </div>
        <p className="keyrow__note muted">
          {service.note}{" "}
          <a href={service.href} target="_blank" rel="noreferrer noopener">Get a key</a>
        </p>

        <div className="keyrow__field">
          <input
            id={inputId}
            type={shown ? "text" : "password"}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setMessage(null);
            }}
            className="mono"
            placeholder={status.configured ? "Paste a new key to replace the saved one" : `${service.name} API key`}
            autoComplete="off"
            spellCheck="false"
            data-1p-ignore="true"
            data-lpignore="true"
            aria-invalid={!valid}
            aria-describedby={valid ? undefined : `${inputId}-error`}
          />
          <Bracket type="button" onClick={() => setShown((v) => !v)} aria-pressed={shown}>
            {shown ? "Hide" : "Show"}
          </Bracket>
        </div>

        {!valid && (
          <p id={`${inputId}-error`} className="keyrow__error" role="alert">
            Use 8 to 256 characters: letters, digits and . _ ~ + / = -
          </p>
        )}

        <div className="keyrow__actions">
          <button type="submit" className="btn btn--solid btn--compact" disabled={!valid || !value || busy}>
            {status.configured ? "Replace" : "Save"}
          </button>
          {status.configured && (
            <button
              type="button"
              className="btn btn--ghost btn--compact"
              disabled={busy}
              onClick={() => void run(() => removeApiKey(service.id), "Removed.")}
            >
              Remove
            </button>
          )}
          <span
            className={`keyrow__message mono ${message?.error ? "is-error" : ""}`}
            role={message?.error ? "alert" : "status"}
          >
            {message?.text}
          </span>
        </div>
      </form>
    </li>
  );
}

export default function ApiKeysSection() {
  const [statuses, setStatuses] = useState<KeyStatuses | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchKeyStatuses().then(
      (s) => alive && setStatuses(s),
      (err: unknown) => alive && setError(err instanceof ApiError ? err.message : "The saved keys could not be loaded."),
    );
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <p className="settings__lead muted">
        Add your own API keys. Argus uses them to call the matching service when you search. A service that needs a key cannot be queried until you add one here.
      </p>
      <p className="settings__note muted">
        Keys are encrypted on the Argus server and tied to your account. They are never sent back to the browser: you only see the last four characters.
      </p>

      {error && (
        <p className="settings__warning" role="alert">{error}</p>
      )}
      {!error && !statuses && <p className="muted" role="status">Loading…</p>}

      {statuses && (
        <ul className="keyrow-list">
          {ORDERED_SERVICES.map((s) => (
            <KeyRow
              key={s.id}
              service={s}
              status={statuses[s.id] ?? { configured: false, hint: null }}
              onStatus={(next) => setStatuses((prev) => ({ ...prev, [s.id]: next }))}
            />
          ))}
        </ul>
      )}
    </>
  );
}
