import type { EngineEvent, EngineRunOptions } from "../engine.js";

/** Broker → runner: the run to execute (EngineRunOptions minus the non-serializable abortController). */
export type JobMessage = { kind: "job" } & Omit<EngineRunOptions, "abortController">;
/** Broker → runner: cancel the in-flight run. */
export type ControlMessage = { kind: "cancel" };
/** Runner → broker: one streamed engine event. */
export type EventMessage = { kind: "event"; event: EngineEvent };
/** Runner → broker: the engine completed normally. */
export type DoneMessage = { kind: "done" };
/** Runner → broker: the engine threw; `message` is the error text. */
export type ErrorMessage = { kind: "error"; message: string };

/** Messages the broker sends to the runner over stdin. */
export type BrokerOut = JobMessage | ControlMessage;
/** Messages the runner sends to the broker over stdout. */
export type RunnerOut = EventMessage | DoneMessage | ErrorMessage;
