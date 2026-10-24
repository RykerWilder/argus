import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Header, { Bracket, Footer } from "../components/Header";
import ToolsMenu from "../components/ToolsMenu";

// Pagina 404. Lo zero di "404" è un occhio (Argo aveva cento occhi) la cui
// iride segue il cursore; un clic sull'occhio lo fa ammiccare e cambia frase.

const LINES = [
  "Argus has a hundred eyes. None of them found this page.",
  "This page was last seen leaving the building.",
  "No VPN, no proxy, no Tor. Just no page.",
  "We looked everywhere. Twice. With all hundred eyes.",
  "Reported 0 times. Seen 0 times. Exists 0 times.",
  "This path is clean: there is nothing on it.",
];

// Escursione massima dell'iride dentro l'occhio, in unità del viewBox.
const REACH_X = 20;
const REACH_Y = 38;

function Eye404({ onBlink }) {
  const svgRef = useRef(null);
  const irisRef = useRef(null);
  const eyeRef = useRef(null);

  useEffect(() => {
    const look = (e) => {
      const svg = svgRef.current;
      const iris = irisRef.current;
      if (!svg || !iris) return;
      const r = svg.getBoundingClientRect();
      // centro dell'occhio: 260/520 della larghezza, 110/220 dell'altezza
      const cx = r.left + r.width * (260 / 520);
      const cy = r.top + r.height * (110 / 220);
      let nx = (e.clientX - cx) / (window.innerWidth * 0.35);
      let ny = (e.clientY - cy) / (window.innerHeight * 0.35);
      const len = Math.hypot(nx, ny);
      if (len > 1) {
        nx /= len;
        ny /= len;
      }
      iris.style.transform = `translate(${(nx * REACH_X).toFixed(2)}px, ${(ny * REACH_Y).toFixed(2)}px)`;
    };
    window.addEventListener("pointermove", look);
    return () => window.removeEventListener("pointermove", look);
  }, []);

  const blink = () => {
    const eye = eyeRef.current;
    if (eye) {
      eye.classList.remove("is-blinking");
      void eye.getBoundingClientRect(); // riavvia l'animazione
      eye.classList.add("is-blinking");
    }
    onBlink();
  };

  return (
    <button type="button" className="notfound__eyebtn" onClick={blink} aria-label="Blink and show another message">
      <svg
        ref={svgRef}
        viewBox="0 0 520 220"
        className="notfound__digits"
        role="img"
        aria-label="404"
        fill="none"
        stroke="currentColor"
        strokeWidth="14"
        strokeLinejoin="miter"
      >
        <path d="M110 200 V20 L20 140 H150" />
        <path d="M460 200 V20 L370 140 H500" />
        <g ref={eyeRef} className="notfound__eye" onAnimationEnd={(e) => e.currentTarget.classList.remove("is-blinking")}>
          <ellipse cx="260" cy="110" rx="62" ry="90" />
          <g ref={irisRef} className="notfound__iris">
            <circle cx="260" cy="110" r="34" fill="var(--accent)" stroke="none" />
            <circle cx="260" cy="110" r="14" fill="var(--accent-ink)" stroke="none" />
          </g>
        </g>
      </svg>
    </button>
  );
}

export default function NotFound() {
  const [line, setLine] = useState(() => Math.floor(Math.random() * LINES.length));
  const next = useCallback(() => setLine((i) => (i + 1) % LINES.length), []);

  useEffect(() => {
    document.title = "Not found · Argus";
    return () => {
      document.title = "Argus";
    };
  }, []);

  return (
    <div className="page page--notfound">
      <Header>
        <ToolsMenu />
        <Link to="/history" className="nav-link nav-link--hide-sm">History</Link>
        <Link to="/sources" className="nav-link nav-link--hide-sm">Sources</Link>
        <Link to="/settings" className="nav-link nav-link--hide-sm">Settings</Link>
        <Bracket as={Link} to="/">New search</Bracket>
      </Header>

      <main className="notfound">
        <Eye404 onBlink={next} />

        <h1 className="notfound__line" aria-live="polite">{LINES[line]}</h1>
        <p className="notfound__lead muted">The address you opened does not match any page of Argus.</p>

        <dl className="notfound__report mono">
          <div>
            <dt>Verdict</dt>
            <dd>Not found</dd>
          </div>
          <div>
            <dt>Reports on file</dt>
            <dd>0. Not even AbuseIPDB has heard of it.</dd>
          </div>
        </dl>
      </main>

      <Footer />
    </div>
  );
}
