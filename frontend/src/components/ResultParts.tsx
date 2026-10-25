import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Lookup, LookupResults, Row, Target } from "../types";
import { Bracket } from "./Header";
import { getCached, runLookup } from "../lib/lookup";
import { classify, resultPath } from "../lib/target";

// Parti comuni alle pagine dei risultati (IP, dominio, URL).

/** Esegue (o riprende dalla cache) la ricerca per `target`; `refresh()` la ripete. */
export function useLookup(target: Target | null) {
  const key = target ? `${target.kind}:${target.value}` : null;
  const [lookup, setLookup] = useState<Lookup | null>(() => (target ? getCached(target) : null));
  const [progress, setProgress] = useState<LookupResults | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!target) return;
    const cached = refresh === 0 ? getCached(target) : null;
    if (cached) {
      setLookup(cached);
      return;
    }
    setLookup(null);
    setProgress(null);
    const controller = new AbortController();
    runLookup(target, { signal: controller.signal, onProgress: setProgress })
      .then(setLookup)
      .catch(() => {});
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refresh]);

  return { lookup, progress, refresh: () => setRefresh((n) => n + 1) };
}

export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · Argus`;
    return () => {
      document.title = "Argus";
    };
  }, [title]);
}

export function QuickSearch({ current }: { current: string | null }) {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  return (
    <form
      className={`quick-search ${invalid ? "has-error" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        const target = classify(value);
        if (target.kind === "invalid") return setInvalid(true);
        setValue("");
        const path = resultPath(target);
        if (path !== current) navigate(path);
      }}
    >
      <label htmlFor="quick-ip" className="sr-only">Search another IP, domain or URL</label>
      <input
        id="quick-ip"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setInvalid(false);
        }}
        placeholder="Argus search"
        title={invalid ? "Enter an IP address, a domain or a URL" : undefined}
        autoComplete="off"
        spellCheck="false"
        aria-invalid={invalid}
      />
    </form>
  );
}

export function Empty({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <section className="empty">
      <h1>{title}</h1>
      <p>{body}</p>
      {children}
      <Bracket as={Link} to="/">Search another address</Bracket>
    </section>
  );
}

// Il titolo (IP o dominio) resta sempre su una riga: si misura la larghezza
// reale del testo con il font caricato e si sceglie la dimensione che entra
// nello spazio disponibile (max 128px). Si ricalcola quando cambia la larghezza
// o finisce di caricarsi il font.
const FIT_MAX = 128;
const FIT_MIN = 14;

export function FitHeading({ text, className = "" }: { text: string; className?: string }) {
  const boxRef = useRef<HTMLHeadingElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const text = textRef.current;
    if (!box || !text) return;
    let frame = 0;
    const fit = () => {
      text.style.fontSize = "100px";
      const natural = text.getBoundingClientRect().width;
      const available = box.clientWidth;
      if (!natural || !available) return;
      const size = Math.max(FIT_MIN, Math.min(FIT_MAX, Math.floor((available / natural) * 100 * 0.98)));
      text.style.fontSize = `${size}px`;
    };
    fit();
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    ro.observe(box);
    document.fonts?.ready.then(fit).catch(() => {});
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [text]);

  return (
    <h1 ref={boxRef} className={`result-ip ${className}`}>
      <span ref={textRef}>{text}</span>
    </h1>
  );
}

interface ScoreProps {
  label: string;
  value: number | null | undefined;
  suffix?: string;
  /** Larghezza della barra (0-100); se manca si usa il valore stesso. */
  percent?: number | null;
}

export function Score({ label, value, suffix, percent }: ScoreProps) {
  const has = value !== null && value !== undefined;
  return (
    <div className="score">
      <span className="score__value mono">
        {has ? value : "—"}
        {has && <small>{suffix}</small>}
      </span>
      <span className="score__label muted">{label}</span>
      <span className="score__bar" aria-hidden="true">
        <span style={{ width: `${Math.max(0, Math.min(100, percent ?? (Number(value) || 0)))}%` }} />
      </span>
    </div>
  );
}

/** Righe `etichetta: valore` per un riquadro, senza quelle che non hanno un valore. */
export function presentRows(rows: { label: string; value: string | null | undefined; mono?: boolean; highlight?: boolean }[]): Row[] {
  return rows.flatMap((r) => (r.value ? [{ ...r, value: r.value }] : []));
}

export function Rows({ rows }: { rows: Row[] }) {
  return (
    <dl className="rows">
      {rows.map((r, i) => (
        <div key={`${r.label}-${i}`} className={`rows__item ${r.highlight ? "is-highlight" : ""}`}>
          <dt>{r.label}</dt>
          <dd>
            <span className={r.mono ? "mono" : undefined}>{r.value}</span>
            {r.differs && <span className="rows__alt">Differs from {r.differs}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
