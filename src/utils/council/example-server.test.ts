import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  startExampleServer,
  type ExampleServerHandle,
} from "./example-server.js";

describe("example-server", () => {
  let handle: ExampleServerHandle;
  let baseUrl: string;

  beforeAll(async () => {
    handle = await startExampleServer();
    baseUrl = `http://127.0.0.1:${handle.port}`;
  });

  afterAll(async () => {
    await handle.close();
  });

  test("GET /health returns 200 with JSON ok body", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { status: string; uptime: number };
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
  });

  test("HEAD /health returns 200 with empty body and JSON headers", async () => {
    const res = await fetch(`${baseUrl}/health`, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const text = await res.text();
    expect(text).toBe("");
  });

  test("GET /health?debug=true ignores query parameters", async () => {
    const res = await fetch(`${baseUrl}/health?debug=true`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  test("GET /health/ normalizes trailing slash", async () => {
    const res = await fetch(`${baseUrl}/health/`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  test("POST /health returns 405 with Allow header", async () => {
    const res = await fetch(`${baseUrl}/health`, { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
    await res.text();
  });

  test("GET / returns 404", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(404);
    await res.text();
  });

  test("GET /unknown returns 404", async () => {
    const res = await fetch(`${baseUrl}/unknown`);
    expect(res.status).toBe(404);
    await res.text();
  });

  test("GET /Health is case-sensitive and returns 404", async () => {
    const res = await fetch(`${baseUrl}/Health`);
    expect(res.status).toBe(404);
    await res.text();
  });

  test("close() terminates the server and active connections", async () => {
    const localHandle = await startExampleServer();
    const localBase = `http://127.0.0.1:${localHandle.port}`;
    const res = await fetch(`${localBase}/health`);
    expect(res.status).toBe(200);
    await res.text();

    const start = Date.now();
    await localHandle.close();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);

    await expect(fetch(`${localBase}/health`)).rejects.toThrow();
  });
});
