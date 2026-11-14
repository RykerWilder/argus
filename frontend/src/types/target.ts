
export type TargetKind = "ip" | "domain" | "url";

export interface IpTarget {
  kind: "ip";
  value: string;
}
export interface DomainTarget {
  kind: "domain";
  value: string;
}
export interface UrlTarget {
  kind: "url";
  value: string;
  host: string;
  hostIsIp: boolean;
}
/** A valid indicator, already recognized by `classify()`. */
export type Target = IpTarget | DomainTarget | UrlTarget;

export interface InvalidTarget {
  kind: "invalid";
  error: string;
}
export type ClassifiedTarget = Target | InvalidTarget;

/** Enough to build a path or a "defanged" version. */
export interface TargetRef {
  kind: TargetKind;
  value: string;
}
