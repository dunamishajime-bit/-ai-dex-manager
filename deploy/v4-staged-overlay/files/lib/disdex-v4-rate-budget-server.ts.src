import { createServer } from "node:net";
import { executeV4BudgetProxyRequest, type V4BudgetBackend } from "./disdex-v4-rate-budget-proxy";

/** Socket protocol only; production binds this server to a protected Unix socket. */
export function createV4BudgetBrokerServer(backend: V4BudgetBackend) {
  const server = createServer((socket) => {
    let raw = "";
    let handled = false;
    socket.setEncoding("utf8");
    socket.setTimeout(10_000, () => socket.destroy());
    socket.on("error", () => socket.destroy());
    socket.on("data", (chunk: string) => {
      if (handled) return socket.destroy();
      raw += chunk;
      if (Buffer.byteLength(raw, "utf8") > 4096) return socket.destroy();
      const end = raw.indexOf("\n");
      if (end < 0) return;
      handled = true;
      if (raw.slice(end + 1).trim()) return socket.destroy();
      void (async () => {
        try {
          const result = await executeV4BudgetProxyRequest(JSON.parse(raw.slice(0, end)), backend);
          socket.end(JSON.stringify(result) + "\n");
        } catch {
          socket.end('{"ok":false}\n');
        }
      })();
    });
  });
  server.maxConnections = 128;
  return server;
}
