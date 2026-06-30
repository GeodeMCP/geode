import * as http from "node:http";
import * as net from "node:net";

/**
 * Returns true when `host` is permitted by at least one pattern.
 * Patterns may be exact hostnames or leading-wildcard globs (`*.example.com`),
 * which match any single subdomain level (e.g. `api.example.com`) but NOT the
 * apex (`example.com`) and NOT deeper levels (`a.b.example.com`).
 */
export function hostAllowed(host: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1); // e.g. ".example.com"
      if (host.endsWith(suffix) && host.slice(0, host.length - suffix.length).indexOf(".") === -1) {
        return true;
      }
    } else if (host === pattern) {
      return true;
    }
  }
  return false;
}

/**
 * Starts a minimal HTTP CONNECT forward-proxy bound to 127.0.0.1 on an
 * ephemeral port. Only CONNECT tunnels whose target host is in `allowlist`
 * are forwarded; all others receive a 403 response.
 */
export async function startEgressProxy(
  allowlist: string[],
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(405).end("Only CONNECT supported");
  });

  server.on("connect", (req, clientSocket: net.Socket, head) => {
    const [targetHost, portStr] = (req.url ?? "").split(":");
    const port = portStr ? parseInt(portStr, 10) : 443;

    if (!hostAllowed(targetHost, allowlist)) {
      clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      clientSocket.destroy();
      return;
    }

    const serverSocket = net.connect(port, targetHost, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head?.length) serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    serverSocket.on("error", () => {
      clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      clientSocket.destroy();
    });

    clientSocket.on("error", () => serverSocket.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });

  const addr = server.address() as net.AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;

  const close = () =>
    new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );

  return { url, close };
}
