import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { buildAnatomy, guessParts } from "../lib/anatomy";

// Il dominio o l'URL intero, diviso nelle sue parti. Passando il mouse (o con
// Tab) su una parte la si evidenzia e sotto compare cosa rappresenta.
//
// Animazioni: le parti entrano una dopo l'altra, una barra scorre sotto la
// parte indicata, le altre si attenuano e la spiegazione entra dal basso.
// Con "riduci movimento" restano solo i cambi di colore.

const STAGGER_MS = 35;
const STAGGER_MAX = 900;

export default function Anatomy({ target }) {
  const host = target.kind === "url" ? target.host : target.value;
  const [parts, setParts] = useState(() => (target.hostIsIp ? null : guessParts(host)));
  const [active, setActive] = useState(null);
  const [marker, setMarker] = useState(null); // { left, top, width }
  const valueRef = useRef(null);
  const segRefs = useRef([]);

  useEffect(() => {
    if (target.hostIsIp) return;
    let alive = true;
    setParts(guessParts(host));
    fetch(`/api/fqdn?host=${encodeURIComponent(host)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive && data?.suffix) setParts({ ...data, guessed: false });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [host, target.hostIsIp]);

  const segments = useMemo(() => buildAnatomy(target, parts || {}), [target, parts]);
  const current = active !== null ? segments[active] : null;

  // posizione della barra sotto la parte attiva (segue anche gli a capo)
  useLayoutEffect(() => {
    if (active === null) return;
    const el = segRefs.current[active];
    const box = valueRef.current;
    if (!el || !box) return;
    const rects = el.getClientRects();
    const r = rects[rects.length - 1] || el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    setMarker({ left: r.left - b.left, top: r.bottom - b.top, width: r.width });
  }, [active, segments]);

  // ordine di entrata: solo le parti vere, i separatori seguono la precedente
  let order = 0;

  return (
    <section className="anatomy" aria-label={`Parts of the ${target.kind === "url" ? "URL" : "domain"}`}>
      <p className="anatomy__label muted">
        {target.kind === "url" ? "Anatomy of the URL" : "Anatomy of the domain"}
      </p>
      <div className="anatomy__stage" ref={valueRef}>
        <p
          className={`anatomy__value mono ${active !== null ? "has-active" : ""}`}
          onPointerLeave={() => setActive(null)}
        >
          {segments.map((s, i) => {
            const delay = Math.min(STAGGER_MAX, order * STAGGER_MS);
            if (s.type !== "sep") order += 1;
            return s.type === "sep" ? (
              <span key={i} className="anatomy__sep" style={{ animationDelay: `${delay}ms` }}>
                {s.text}
              </span>
            ) : (
              <span
                key={i}
                ref={(el) => (segRefs.current[i] = el)}
                className={`anatomy__seg anatomy__seg--${s.type} ${active === i ? "is-active" : ""}`}
                style={{ animationDelay: `${delay}ms` }}
                tabIndex={0}
                onPointerEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive((a) => (a === i ? null : a))}
                aria-describedby="anatomy-caption"
              >
                {s.text}
              </span>
            );
          })}
        </p>
        <span
          className={`anatomy__marker ${active !== null && marker ? "is-visible" : ""}`}
          style={marker ? { transform: `translate(${marker.left}px, ${marker.top}px)`, width: marker.width } : undefined}
          aria-hidden="true"
        />
      </div>
      <div id="anatomy-caption" className="anatomy__caption" aria-live="polite">
        {current ? (
          <div key={active} className="anatomy__caption-inner">
            <strong>{current.title}</strong>
            <span className="mono anatomy__part">{current.text}</span>
            <p>{current.body}</p>
          </div>
        ) : (
          <div key="idle" className="anatomy__caption-inner">
            <p className="muted">
              Point at a part to see what it is.
              {parts?.guessed && !target.hostIsIp && " Suffix detection is approximate until the backend responds."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
