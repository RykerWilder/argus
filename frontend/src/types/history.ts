import type { VerdictLevel } from "./report";
import type { TargetKind } from "./target";

export interface HistoryEntry {
  id: number;
  kind: TargetKind;
  value: string;
  firstSearchedAt: string;
  lastSearchedAt: string;
  times: number;
  verdictLevel: VerdictLevel;
  verdictTitle: string | null;
  summary: string | null;
}

export interface HistoryData {
  entries: HistoryEntry[];
  counts: Partial<Record<TargetKind, number>>;
}
