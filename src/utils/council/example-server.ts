import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { type Socket } from "node:net";

export interface ExampleServerHandle {
  port: number;
  close: () => Promise<void>;
}

export interface ExampleServerOptions {
  port?: number;
  host?: string;
}

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function writeJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
  includeBody = true,
): void {
  const payload = JSON.stringify(body);
  const headers: Record<string, string | number> = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    ...extraHeaders,
  };
  res.writeHead(status, headers);
  if (includeBody) {
    res.end(payload);
  } else {
    res.end();
  }
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  try {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = normalizePathname(url.pathname);
    const method = (req.method || "GET").toUpperCase();

    if (pathname === "/health") {
      if (method !== "GET" && method !== "HEAD") {
        writeJson(
          res,
          405,
          { error: "Method Not Allowed" },
          { Allow: "GET, HEAD" },
        );
        return;
      }
      const body = { status: "ok", uptime: process.uptime() };
      writeJson(res, 200, body, undefined, method !== "HEAD");
      return;
    }

    writeJson(res, 404, { error: "Not Found" });
  } catch {
    try {
      writeJson(res, 500, { error: "Internal Server Error" });
    } catch {
      // Response may already be written; nothing else to do.
    }
  }
}

export function startExampleServer(
  options: ExampleServerOptions = {},
): Promise<ExampleServerHandle> {
  const port = options.port ?? 0;
  const host = options.host ?? "127.0.0.1";

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => handleRequest(req, res));
    const activeSockets = new Set<Socket>();

    server.on("connection", (socket) => {
      activeSockets.add(socket);
      socket.once("close", () => {
        activeSockets.delete(socket);
      });
    });

    server.once("error", reject);

    server.listen(port, host, () => {
      server.removeListener("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to determine server address"));
        return;
      }
      const actualPort = address.port;

      const close = (): Promise<void> =>
        new Promise<void>((resolveClose, rejectClose) => {
          server.close((err) => {
            if (err) {
              rejectClose(err);
              return;
            }
            resolveClose();
          });
          for (const socket of activeSockets) {
            socket.destroy();
          }
          activeSockets.clear();
        });

      resolve({ port: actualPort, close });
    });
  });
}
