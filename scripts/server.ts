import { spawn } from "node:child_process";
import { once } from "node:events";
import { closeSync, openSync } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createHost, webSocketLink } from "@earendil-works/chord";
import WebSocket from "ws";
import { Server, type Principal, type ServerStatus } from "../src/api/contract.ts";
import { monchuHome } from "../src/core/home.ts";
import { socketPath, stopServer } from "../src/server/socket.ts";

async function readStatus(path: string): Promise<ServerStatus | undefined> {
  const host = createHost<Principal>({
    name: "server-control",
    kind: "client",
    self: { kind: "core" },
    onError: () => {},
  });
  const socket = new WebSocket("ws://monchu/api", {
    createConnection: () => connect(path),
    handshakeTimeout: 500,
  });
  const link = webSocketLink(socket);
  socket.on("error", () => {});
  try {
    if (
      !(await once(socket, "open").then(
        () => true,
        () => false,
      ))
    )
      return undefined;
    host.connect(link, { principal: { kind: "core" } });
    const server = await host.get(Server, {}, { signal: AbortSignal.timeout(3000) });
    return server.state.value;
  } finally {
    link.close();
    await host.close();
  }
}

try {
  const [command, ...extra] = process.argv.slice(2);
  if (!command || !["up", "down", "restart", "status"].includes(command) || extra.length)
    throw new Error("Usage: mise run server -- up|down|restart|status");
  const home = await monchuHome(process.env.MONCHU_DEV_FAUX === "1");
  const path = socketPath(home);
  const entry = fileURLToPath(new URL("../dist/main.js", import.meta.url));
  if (command === "up" || command === "restart")
    await access(entry).catch(() => {
      throw new Error("Build this checkout first: mise run build");
    });
  if (
    (command === "down" || command === "restart") &&
    process.env.MONCHU_CORE_HOME === resolve(home)
  )
    throw new Error("Use /restart inside Monchu, or run this script from your own terminal");

  let status = await readStatus(path);
  if (command === "down" || command === "restart") {
    if (status !== undefined) {
      await stopServer(path);
      const deadline = Date.now() + 30_000;
      for (;;) {
        try {
          process.kill(status.pid, 0);
        } catch (error) {
          if (error instanceof Error && "code" in error && error.code === "ESRCH") break;
          throw error;
        }
        if (Date.now() >= deadline) throw new Error("Shutdown timed out; no replacement started");
        await sleep(100);
      }
      status = undefined;
    }
  }

  if ((command === "up" || command === "restart") && status === undefined) {
    const run = join(home, "run");
    const log = join(run, "server.log");
    await mkdir(run, { recursive: true, mode: 0o700 });
    const output = openSync(log, "a", 0o600);
    const child = spawn(process.execPath, [entry, "serve", "--web"], {
      detached: true,
      stdio: ["ignore", output, output],
      env: {
        ...process.env,
        ...(process.env.MONCHU_DEV_FAUX === "1" ? { MONCHU_DEV_HOME: home } : {}),
      },
    });
    try {
      await once(child, "spawn");
      child.unref();
    } finally {
      closeSync(output);
    }
    const deadline = Date.now() + 60_000;
    for (;;) {
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`Server exited during startup; see ${log}`);
      status = await readStatus(path);
      if (status !== undefined && status.pid === child.pid && status.core.state === "running") {
        if (status.web === null) throw new Error(`Web is off; check web.json and ${log}`);
        break;
      }
      if (Date.now() >= deadline) throw new Error(`Startup timed out; see ${log}`);
      await sleep(100);
    }
  }

  console.log(
    status === undefined
      ? `monchu · stopped · ${home}`
      : `monchu · server ${status.pid} · core ${status.core.state} (${status.core.pid ?? "none"}) · web ${status.web ?? "off"}`,
  );
} catch (error) {
  console.error(`monchu · ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
