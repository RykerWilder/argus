import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Header, { Bracket, Footer } from "../components/Header";
import ToolsMenu from "../components/ToolsMenu";
import LookupProgress from "../components/LookupProgress";
import NetworkBackground from "../components/NetworkBackground";
import { getCached, runLookup, sourcesFor } from "../lib/lookup";
import { classify, resultPath } from "../lib/target";

export default function Home() {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(null); // { target, progress }
  const [findingMine, setFindingMine] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
    return () => abortRef.current?.abort();
  }, []);

  async function analyze(raw) {
    const target = classify(raw);
    if (target.kind === "invalid") {
      setError(target.error);
      return;
    }
    setError(null);

    const path = resultPath(target);
    if (getCached(target)) {
      navigate(path);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning({ target, progress: null });
    try {
      await runLookup(target, {
        signal: controller.signal,
        onProgress: (progress) => setRunning({ target, progress }),
      });
      navigate(path);
    } catch (err) {
      if (err.name !== "AbortError") {
        setRunning(null);
        setError("The lookup was interrupted. Try again.");
      }
    }
  }

  async function useMyIp() {
    setFindingMine(true);
    setError(null);
    try {
      const res = await fetch("https://api.ipify.org?format=json");
      const { ip } = await res.json();
      setValue(ip);
      analyze(ip);
    } catch {
      setError("Your public IP could not be detected. Type it in instead.");
    } finally {
      setFindingMine(false);
    }
  }

  function cancel() {
    abortRef.current?.abort();
    setRunning(null);
    inputRef.current?.focus();
  }

  return (
    <div className="page page--home">
      <NetworkBackground />
      <Header>
        <ToolsMenu />
        <Link to="/history" className="nav-link">History</Link>
        <Link to="/sources" className="nav-link">Sources</Link>
        <Bracket type="button" onClick={useMyIp} disabled={findingMine || !!running}>
          {findingMine ? "Detecting…" : "Check my IP"}
        </Bracket>
      </Header>

      <main>
        <section className="search" aria-labelledby="search-title">
          <h1 id="search-title" className="search__title">Look up an IP, domain or URL</h1>
          <form
            className={`search__form ${error ? "has-error" : ""}`}
            onSubmit={(e) => {
              e.preventDefault();
              if (!running) analyze(value);
            }}
          >
            <label htmlFor="ip-input" className="sr-only">IP address, domain or URL</label>
            <input
              id="ip-input"
              ref={inputRef}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Argus search"
              autoComplete="off"
              spellCheck="false"
              inputMode="text"
              disabled={!!running}
              aria-invalid={!!error}
              aria-describedby={error ? "ip-error" : undefined}
            />
            {running ? (
              <button type="button" className="btn btn--ghost" onClick={cancel}>
                Cancel
              </button>
            ) : (
              <button type="submit" className="btn btn--solid">
                Analyze <span className="btn__square" aria-hidden="true" />
              </button>
            )}
          </form>

          {error && (
            <p id="ip-error" className="search__error" role="alert">
              {error}
            </p>
          )}

          {running && (
            <LookupProgress
              label={running.target.value}
              progress={running.progress}
              sources={sourcesFor(running.target)}
            />
          )}
        </section>
      </main>
      <Footer minimal />
    </div>
  );
}
