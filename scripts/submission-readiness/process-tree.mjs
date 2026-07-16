import { once } from "node:events";

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return child.exitCode;
  }
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("Process did not stop before the timeout")),
      timeoutMs,
    );
  });
  try {
    const [code] = await Promise.race([once(child, "exit"), timeout]);
    return code;
  } finally {
    clearTimeout(timeoutId);
  }
}

function signalProcessGroup(processGroupId, signal) {
  try {
    process.kill(-processGroupId, signal);
    return true;
  } catch (error) {
    // Darwin can report EPERM while an exited group leader is being reaped.
    // The individually-addressable leader remains the fallback when it is live.
    if (error?.code === "ESRCH" || error?.code === "EPERM") return false;
    throw error;
  }
}

function processGroupIsAlive(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH" || error?.code === "EPERM") return false;
    throw error;
  }
}

async function waitForProcessGroupExit(processGroupId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupIsAlive(processGroupId)) {
    if (Date.now() >= deadline) {
      throw new Error("Process group did not stop before the timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export async function stopProcessLeader(child, signal, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    await terminateProcessTree(child, 250);
    return child.exitCode;
  }
  child.kill(signal);
  const exitCode = await waitForExit(child, timeoutMs);
  await terminateProcessTree(child, 250);
  return exitCode;
}

export async function terminateProcessTree(child, graceMs = 2_000) {
  const leaderIsAlive = child.exitCode === null && child.signalCode === null;
  const groupWasSignalled = signalProcessGroup(child.pid, "SIGTERM");
  if (!groupWasSignalled && leaderIsAlive) child.kill("SIGTERM");
  try {
    await Promise.all([
      leaderIsAlive ? waitForExit(child, graceMs) : Promise.resolve(),
      groupWasSignalled
        ? waitForProcessGroupExit(child.pid, graceMs)
        : Promise.resolve(),
    ]);
    return;
  } catch {
    const groupWasKilled = signalProcessGroup(child.pid, "SIGKILL");
    if (
      !groupWasKilled &&
      child.exitCode === null &&
      child.signalCode === null
    ) {
      child.kill("SIGKILL");
    }
    await Promise.all([
      child.exitCode === null && child.signalCode === null
        ? waitForExit(child, 2_000)
        : Promise.resolve(),
      groupWasKilled
        ? waitForProcessGroupExit(child.pid, 2_000)
        : Promise.resolve(),
    ]).catch(() => undefined);
  }
}
