import { useState } from "react";
import { Bracket } from "../Header";
import { API_KEY_PATTERN, API_KEY_SERVICES, getApiKey, setApiKey } from "../../lib/settings";

function KeyRow({ service }) {
  const [saved, setSaved] = useState(() => getApiKey(service.id));
  const [draft, setDraft] = useState(saved);
  const [shown, setShown] = useState(false);
  const [message, setMessage] = useState(null);

  const value = draft.trim();
  const valid = value === "" || API_KEY_PATTERN.test(value);
  const dirty = value !== saved;
  const inputId = `key-${service.id}`;

  function save(e) {
    e.preventDefault();
    if (!valid || !dirty) return;
    setApiKey(service.id, value);
    setSaved(value);
    setDraft(value);
    setMessage(value ? "Saved." : "Removed.");
  }

  function remove() {
    setApiKey(service.id, "");
    setSaved("");
    setDraft("");
    setMessage("Removed.");
  }

  return (
    <li className="keyrow">
      <form onSubmit={save}>
        <div className="keyrow__head">
          <label htmlFor={inputId} className="keyrow__name">{service.name}</label>
          <span className="keyrow__tag mono">{service.required ? "Required" : "Optional"}</span>
          <span className={`keyrow__state mono ${saved ? "is-set" : ""}`}>{saved ? "Saved in this browser" : "Not set"}</span>
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
            placeholder={`${service.name} API key`}
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
          <button type="submit" className="btn btn--solid btn--compact" disabled={!valid || !dirty}>
            Save
          </button>
          {saved && (
            <button type="button" className="btn btn--ghost btn--compact" onClick={remove}>
              Remove
            </button>
          )}
          <span className="keyrow__message mono" role="status">{message}</span>
        </div>
      </form>
    </li>
  );
}

export default function ApiKeysSection() {
  return (
    <>
      <p className="settings__lead muted">
        Add your own API keys. Argus sends the key you save to the matching service with each search; the server does not keep any. A service that needs a key cannot be queried until you add one here.
      </p>
      <p className="settings__note muted">
        Keys are stored in this browser&rsquo;s local storage, in plain text, and are sent to the Argus backend only to call the matching service. Anyone who can use this browser profile can read them.
      </p>
      <ul className="keyrow-list">
        {API_KEY_SERVICES.map((s) => (
          <KeyRow key={s.id} service={s} />
        ))}
      </ul>
    </>
  );
}
