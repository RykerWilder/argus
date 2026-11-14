// The signed-in user (sign-in is done by Authelia, in front of nginx), their second factor,
// API keys and password. Everything lives on the server: here there are only the calls to
// /api/me and /api/keys.

import { useEffect, useState } from "react";
import { ApiError, putJson, postJson, request } from "../api";
import { API_KEY_SERVICES, LEGACY_API_KEYS_KEY, API_KEY_PATTERN } from "./settings";
import type { SourceId } from "../../types";

/** Second sign-in factor (code from a TOTP app or security key), managed by Authelia. */
export interface Mfa {
  enabled: boolean;
  /** Enforced by the server for all users (ARGUS_AUTH_POLICY=two_factor): cannot be changed from here. */
  required: boolean;
  /** Page of the Authelia portal where devices are registered and removed. Empty if unknown. */
  manageUrl: string;
}

export interface Account {
  username: string;
  displayName: string;
  email: string;
  /** Sign-out address of the Authelia portal. Empty if the backend does not know it (development without Authelia). */
  logoutUrl: string;
  mfa: Mfa;
}

/** Whether a key is saved and its last 4 characters: the full key never leaves the server. */
export interface KeyStatus {
  configured: boolean;
  hint: string | null;
}

export type KeyStatuses = Partial<Record<SourceId, KeyStatus>>;

let current: Account | null = null;
let pending: Promise<Account> | null = null;

/** The user's profile: a single request, then the response stays in memory. */
export function loadAccount(): Promise<Account> {
  pending ??= request<Account>("/api/me").then(
    (account) => {
      current = account;
      return account;
    },
    (err: unknown) => {
      pending = null;  // on the next visit it is retried
      throw err;
    },
  );
  return pending;
}

/** The user, or null until it arrives (or if the request failed). */
export function useAccount(): Account | null {
  const [account, setAccount] = useState<Account | null>(current);
  useEffect(() => {
    let alive = true;
    loadAccount().then(
      (a) => alive && setAccount(a),
      () => undefined,  // errors are shown by the pages that need them
    );
    return () => {
      alive = false;
    };
  }, []);
  return account;
}

/**
 * Turns the second factor on or off. Turning it off needs the password. Turning it on does
 * not change the current session, but Authelia will ask for the second factor on the next
 * request: the caller reloads the page and nginx takes the user to the portal to register
 * the device.
 */
export async function setMfa(enabled: boolean, password = ""): Promise<Mfa> {
  const mfa = await putJson<Mfa>("/api/me/mfa", { enabled, password });
  if (current) current = { ...current, mfa };
  return mfa;
}

export const fetchKeyStatuses = () => request<KeyStatuses>("/api/keys");

export const saveApiKey = (service: SourceId, key: string) => putJson<KeyStatus>(`/api/keys/${service}`, { key });

export const removeApiKey = (service: SourceId) => request<KeyStatus>(`/api/keys/${service}`, { method: "DELETE" });

/**
 * Earlier versions of Argus kept the keys in clear in the browser. On the first visit after
 * the update they move to the server (only for services that do not already have one) and
 * are deleted from the browser. If something goes wrong they stay where they are and it is
 * retried on the next visit.
 */
export async function migrateLegacyKeys(): Promise<void> {
  let legacy: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LEGACY_API_KEYS_KEY) || "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      if (parsed !== null) localStorage.removeItem(LEGACY_API_KEYS_KEY);
      return;
    }
    legacy = parsed as Record<string, unknown>;
  } catch {
    return;  // storage not available or unreadable content: nothing to move
  }

  try {
    const statuses = await fetchKeyStatuses();
    for (const service of API_KEY_SERVICES) {
      const value = legacy[service.id];
      if (typeof value !== "string" || statuses[service.id]?.configured) continue;
      const key = value.trim();
      if (API_KEY_PATTERN.test(key)) await saveApiKey(service.id, key);
    }
    localStorage.removeItem(LEGACY_API_KEYS_KEY);
  } catch (err) {
    // session expired or server unreachable: the keys stay in the browser
    if (!(err instanceof ApiError)) throw err;
  }
}

export const changePassword = (current: string, next: string) =>
  postJson<{ ok: true }>("/api/me/password", { current, new: next });

/** Allowed password length (same rule as the backend: security.py). */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
