import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";

import { stopProcessLeader, terminateProcessTree } from "./process-tree.mjs";

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

async function waitForProcessToDisappear(pid: number, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processIsAlive(pid)) return true;
    await delay(25);
  }
  return !processIsAlive(pid);
}

describe("detached process cleanup", () => {
  it("allows the leader to handle SIGINT before sweeping descendants", async () => {
    const descendantScript =
      "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
    const leaderScript = [
      "const {spawn}=require('node:child_process')",
      `const child=spawn(process.execPath,['-e',${JSON.stringify(descendantScript)}],{stdio:'ignore'})`,
      "process.stdout.write(String(child.pid))",
      "process.on('SIGINT',()=>process.exit(0))",
      "setInterval(()=>{},1000)",
    ].join(";");
    const child = spawn(process.execPath, ["-e", leaderScript], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [pidChunk] = await once(child.stdout, "data");
    const descendantPid = Number(String(pidChunk));
    try {
      await expect(stopProcessLeader(child, "SIGINT", 2_000)).resolves.toBe(0);
      await expect(waitForProcessToDisappear(descendantPid)).resolves.toBe(
        true,
      );
    } finally {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {}
    }
  });

  it("terminates a detached process group after its leader has exited", async () => {
    const descendantScript =
      "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
    const leaderScript = [
      "const {spawn}=require('node:child_process')",
      `const child=spawn(process.execPath,['-e',${JSON.stringify(descendantScript)}],{stdio:'ignore'})`,
      "process.stdout.write(String(child.pid))",
      "setTimeout(()=>process.exit(1),50)",
    ].join(";");
    const child = spawn(process.execPath, ["-e", leaderScript], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [pidChunk] = await once(child.stdout, "data");
    const descendantPid = Number(String(pidChunk));
    await once(child, "exit");
    try {
      await terminateProcessTree(child, 100);
      await expect(waitForProcessToDisappear(descendantPid)).resolves.toBe(
        true,
      );
    } finally {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {}
    }
  });
});
