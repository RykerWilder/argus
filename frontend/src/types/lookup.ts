import type { SourceData } from "./responses";
import type { SourceId } from "./source";
import type { Target } from "./target";

export type ResultStatus = "pending" | "ok" | "error";

export type SourceResult =
  | { status: "pending" }
  | { status: "ok"; data: SourceData; ms: number }
  | { status: "error"; error: string; code?: number; ms: number };

export type SourceError = Extract<SourceResult, { status: "error" }>;

/** One result per queried source (absent if not queried). */
export type LookupResults = Partial<Record<SourceId, SourceResult>>;

export interface Lookup {
  target: Target;
  /** Only for IP address lookups. */
  ip?: string;
  finishedAt: number;
  results: LookupResults;
}
