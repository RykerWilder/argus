// Unico punto da cui il frontend fa richieste HTTP: JSON in entrata e in uscita,
// timeout, annullamento e messaggi d'errore leggibili. Chi chiama non ripete
// fetch / res.ok / res.json() e ha a che fare con un solo tipo di errore.

const DEFAULT_TIMEOUT = 30_000;

/** Errore di una richiesta. `status` è il codice HTTP, assente se il server non ha risposto. */
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function messageFor(status, data) {
  // FastAPI mette il motivo in `detail`; per gli errori di validazione è una lista
  if (typeof data?.detail === "string") return data.detail;
  // nginx risponde 413 (con una pagina HTML) quando il corpo supera il limite
  if (status === 413) return "The upload is too large.";
  return `The request failed (HTTP ${status}).`;
}

/**
 * Richiesta con risposta JSON.
 *
 * - `body`: oggetto da inviare come JSON (se presente, il metodo di solito è POST).
 * - `signal`: per annullare dall'esterno. In quel caso l'errore è un AbortError
 *   del browser, non un ApiError, così chi annulla può riconoscerlo e ignorarlo.
 * - `timeout`: millisecondi prima di rinunciare (ApiError "timed out").
 *
 * Restituisce il JSON della risposta oppure lancia ApiError.
 */
export async function request(url, { method = "GET", body, headers, signal, timeout = DEFAULT_TIMEOUT } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);
  const forwardAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", forwardAbort, { once: true });

  try {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (timedOut) throw new ApiError("The request timed out.");
      if (err.name === "AbortError") throw err; // annullata da chi ha chiamato
      throw new ApiError("The backend could not be reached.");
    }

    const data = await res.json().catch(() => null);
    if (timedOut) throw new ApiError("The request timed out.");
    if (!res.ok) throw new ApiError(messageFor(res.status, data), res.status);
    if (data === null) throw new ApiError("The server sent an unreadable response.", res.status);
    return data;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

/** POST con corpo JSON. */
export const postJson = (url, body, options) => request(url, { ...options, method: "POST", body });
