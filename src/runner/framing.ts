/** Encodes one message as a single newline-terminated JSON line. */
export function encodeLine(msg: unknown): string {
  return JSON.stringify(msg) + "\n";
}

/** Creates a stateful decoder that buffers partial input and returns complete JSON messages per chunk. */
export function createLineDecoder(): (chunk: string) => unknown[] {
  let buf = "";
  return (chunk: string) => {
    buf += chunk;
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    const out: unknown[] = [];
    for (const line of parts) if (line.trim()) out.push(JSON.parse(line));
    return out;
  };
}
