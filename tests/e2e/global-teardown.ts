import * as fs from "node:fs";
import * as path from "node:path";
import { execa } from "execa";

const CONTAINER_NAME_FILE = path.resolve(import.meta.dirname, ".standalone-container");
const DEV_SERVER_PID_FILE = path.resolve(import.meta.dirname, ".dev-server.pid");

function stopDevServer(): void {
  if (!fs.existsSync(DEV_SERVER_PID_FILE)) return;
  const pid = Number(fs.readFileSync(DEV_SERVER_PID_FILE, "utf-8").trim());
  if (Number.isFinite(pid)) {
    console.log(`[e2e:global-teardown] stopping dev server (pid ${pid})...`);
    try {
      // Negative pid == whole process group (spawned with detached: true in
      // global-setup.ts) — npm's own child (vite) would otherwise survive.
      process.kill(-pid, "SIGTERM");
    } catch {
      // Already gone — fine.
    }
  }
  fs.rmSync(DEV_SERVER_PID_FILE, { force: true });
}

export default async function globalTeardown(): Promise<void> {
  stopDevServer();

  if (process.env.E2E_KEEP_STANDALONE === "true") {
    console.log("[e2e:global-teardown] E2E_KEEP_STANDALONE=true — leaving the container running.");
    return;
  }
  if (!fs.existsSync(CONTAINER_NAME_FILE)) return;

  const containerName = fs.readFileSync(CONTAINER_NAME_FILE, "utf-8").trim();
  console.log(`[e2e:global-teardown] stopping container "${containerName}"...`);
  await execa("docker", ["rm", "--force", "--volumes", containerName], { reject: false });
  fs.rmSync(CONTAINER_NAME_FILE, { force: true });
}
