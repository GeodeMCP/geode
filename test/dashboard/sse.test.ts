import { expect, test } from "vitest";
import { openSse } from "../../src/dashboard/sse.js";

function fakeRes() {
  const chunks: string[] = []; let ended = false; const headers: Record<string, string> = {};
  return {
    chunks, get ended() { return ended; }, headers,
    setHeader(k: string, v: string) { headers[k] = v; },
    write(s: string) { chunks.push(s); return true; },
    end() { ended = true; },
    flushHeaders() {},
  } as any;
}

test("openSse sets headers and frames events as `event:`/`data:`", () => {
  const res = fakeRes();
  const sse = openSse(res);
  sse.send("progress", { message: "step 1" });
  sse.send("result", { text: "done" });
  sse.close();
  expect(res.headers["Content-Type"]).toBe("text/event-stream");
  expect(res.chunks.join("")).toBe(
    'event: progress\ndata: {"message":"step 1"}\n\nevent: result\ndata: {"text":"done"}\n\n',
  );
  expect(res.ended).toBe(true);
});
