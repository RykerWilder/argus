import { IP_SOURCES } from "../lib/lookup";

const STATUS_TEXT = {
  pending: "Querying",
  ok: "Done",
  error: "Unavailable",
};

export default function LookupProgress({ label, ip, progress, sources = IP_SOURCES }) {
  const SOURCES = sources;
  const done = SOURCES.filter((s) => progress?.[s.id]?.status && progress[s.id].status !== "pending").length;

  return (
    <div className="progress" role="status" aria-live="polite">
      <p className="progress__title">
        <span>
          Analyzing <span className="mono progress__target">{label ?? ip}</span>
        </span>
        <span className="progress__count mono">
          {done}/{SOURCES.length}
        </span>
      </p>
      <div className="progress__bar" aria-hidden="true">
        <span style={{ width: `${(done / SOURCES.length) * 100}%` }} />
      </div>
      <ul className="progress__list">
        {SOURCES.map((s) => {
          const r = progress?.[s.id] || { status: "pending" };
          return (
            <li key={s.id} className={`progress__item is-${r.status}`}>
              <span className="progress__dot" aria-hidden="true" />
              <span className="progress__name">{s.name}</span>
              <span className="progress__covers">{s.covers}</span>
              <span className="progress__state mono">
                {STATUS_TEXT[r.status]}
                {r.ms !== undefined && ` ${r.ms} ms`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
