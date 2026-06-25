import type { Response } from "express";

/** Represents an open Server-Sent Events channel that can push named events and be closed. */
export interface SseChannel { send(event: string, data: unknown): void; close(): void }

/** Configures the Express response for Server-Sent Events and returns a channel for sending named events. */
export function openSse(res: Response): SseChannel {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  return {
    send(event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); },
    close() { res.end(); },
  };
}
