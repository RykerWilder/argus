// Interruttore on/off accessibile (role="switch"), nello stile di Argus.
export default function Toggle({ checked, onChange, label, id }) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      className={`toggle ${checked ? "is-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle__thumb" aria-hidden="true" />
    </button>
  );
}
