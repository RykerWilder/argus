// Shared Argus types: indicators, backend responses, reports built by the frontend and
// email analysis reports. There is no executable code here.
//
// Backend (FastAPI) responses are not validated at runtime: the types describe what the
// backend sends today (see backend/app/). Fields the frontend treats as optional are
// declared optional.

export * from "./target";
export * from "./source";
export * from "./responses";
export * from "./lookup";
export * from "./report";
export * from "./history";
export * from "./map";
export * from "./email";
