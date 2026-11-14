// Accessible on/off switch (role="switch"), in Argus's style.
interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  id?: string;
  /** Cannot be changed (for example because the server sets it). Still readable by screen reader users. */
  disabled?: boolean;
}

export default function Toggle({ checked, onChange, label, id, disabled = false }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`toggle ${checked ? "is-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle__thumb" aria-hidden="true" />
    </button>
  );
}
