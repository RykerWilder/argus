// The single place the frontend makes HTTP requests from: JSON in and out, timeouts,
// cancellation and readable error messages. Callers do not repeat fetch / res.ok /
// res.json() and deal with a single error type.

const DEFAULT_TIMEOUT = 30_000;

/** Options of `request`. */
export interface RequestOptions {
  method?: string;
  /** Object to send as JSON. */
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Milliseconds before giving up. */
  timeout?: number;
}

/** Error of a request. `status` is the HTTP code, absent if the server did not answer. */
export class ApiError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** When nginx no longer recognizes the Authelia session it answers 401 with this `code` (see nginx/default.conf.template). */
const LOGIN_REQUIRED = "login_required";

/** When the reload towards sign-in was last done: avoids a loop if something goes wrong. */
const LOGIN_RELOAD_KEY = "argus:login-reload";

function isLoginRequired(status: number, data: unknown): boolean {
  return status === 401 && (data as { code?: unknown } | null)?.code === LOGIN_REQUIRED;
}

/**
 * The session expired: reloading the page makes nginx redirect to the Authelia sign-in,
 * which returns here after login. A 401 from an external service (invalid API key) does
 * not come through here: it has no nginx `code`.
 */
function reloadToLogin(): void {
  try {
    const last = Number(sessionStorage.getItem(LOGIN_RELOAD_KEY) || 0);
    if (Date.now() - last < 15_000) return;  // just tried: no repeated reloads
    sessionStorage.setItem(LOGIN_RELOAD_KEY, String(Date.now()));
  } catch {
    // sessionStorage not available: reload anyway
  }
  window.location.reload();
}

/** True for the error of a cancelled request (AbortController), which is not an ApiError. */
export function isAbortError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "name" in err && err.name === "AbortError";
}

function messageFor(status: number, data: unknown): string {
  // FastAPI puts the reason in `detail`; for validation errors it is a list
  const detail = (data as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  // nginx answers 413 (with an HTML page) when the body exceeds the limit
  if (status === 413) return "The upload is too large.";
  return `The request failed (HTTP ${status}).`;
}

/**
 * Request with a JSON response.
 *
 * - `body`: object to send as JSON (if present, the method is usually POST).
 * - `signal`: to cancel from outside. In that case the error is the browser's AbortError,
 *   not an ApiError, so the caller can recognize it and ignore it.
 * - `timeout`: milliseconds before giving up (ApiError "timed out").
 *
 * Returns the response JSON (of type `T`, not validated) or throws ApiError.
 */
export async function request<T = unknown>(
  url: string,
  { method = "GET", body, headers, signal, timeout = DEFAULT_TIMEOUT }: RequestOptions = {},
): Promise<T> {
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
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (timedOut) throw new ApiError("The request timed out.");
      if (isAbortError(err)) throw err;  // cancelled by the caller
      throw new ApiError("The backend could not be reached.");
    }

    const data: unknown = await res.json().catch(() => null);
    if (timedOut) throw new ApiError("The request timed out.");
    if (isLoginRequired(res.status, data)) {
      reloadToLogin();
      throw new ApiError("Your session has expired. Signing you in again…", 401);
    }
    if (!res.ok) throw new ApiError(messageFor(res.status, data), res.status);
    if (data === null) throw new ApiError("The server sent an unreadable response.", res.status);
    return data as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

/** PUT with a JSON body. */
export const putJson = <T = unknown>(url: string, body: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
  request<T>(url, { ...options, method: "PUT", body });

/** POST with a JSON body. */
export const postJson = <T = unknown>(url: string, body: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
  request<T>(url, { ...options, method: "POST", body });
