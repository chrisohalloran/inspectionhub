import { readFile } from "node:fs/promises";
import YAML from "yaml";

const lockfile = YAML.parse(await readFile("pnpm-lock.yaml", "utf8"));
const queries = [];

for (const key of Object.keys(lockfile.packages ?? {})) {
  const delimiter = key.lastIndexOf("@");
  if (delimiter <= 0) continue;
  const name = key.slice(0, delimiter);
  const version = key.slice(delimiter + 1);
  if (!name.startsWith("@inspection/") && /^\d/u.test(version)) {
    queries.push({ package: { ecosystem: "npm", name }, version });
  }
}

async function requestJson(url, init) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return response.json();
}

const affected = [];
for (let index = 0; index < queries.length; index += 500) {
  const slice = queries.slice(index, index + 500);
  const result = await requestJson("https://api.osv.dev/v1/querybatch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ queries: slice }),
  });
  result.results.forEach((entry, offset) => {
    for (const vulnerability of entry.vulns ?? []) {
      affected.push({ dependency: slice[offset], id: vulnerability.id });
    }
  });
}

const uniqueIds = [...new Set(affected.map((entry) => entry.id))];
const advisories = new Map();
for (const id of uniqueIds) {
  advisories.set(id, await requestJson(`https://api.osv.dev/v1/vulns/${id}`));
}

const explicitlyNonBlockingSeverities = new Set(["LOW", "MODERATE", "MEDIUM"]);
function advisorySeverity(advisory) {
  const severity = String(advisory?.database_specific?.severity ?? "")
    .trim()
    .toUpperCase();
  return severity || "UNKNOWN";
}

if (
  advisorySeverity({}) !== "UNKNOWN" ||
  explicitlyNonBlockingSeverities.has(advisorySeverity({}))
) {
  throw new Error(
    "Dependency-audit invariant failed: unknown severity must block",
  );
}

// Unknown/unparseable severity is blocking. A provider omitting a severity must
// never silently downgrade a dependency finding into the passing bucket.
const blocking = affected.filter((entry) => {
  const severity = advisorySeverity(advisories.get(entry.id));
  return !explicitlyNonBlockingSeverities.has(severity);
});
const nonBlocking = affected.filter((entry) => !blocking.includes(entry));

if (blocking.length > 0) {
  process.stderr.write(
    `OSV dependency audit failed:\n${blocking
      .map((entry) => {
        const advisory = advisories.get(entry.id);
        return `${entry.dependency.package.name}@${entry.dependency.version}: ${entry.id} ${advisorySeverity(advisory)} ${advisory?.summary ?? ""}`;
      })
      .join("\n")}\n`,
  );
  process.exit(1);
}

if (nonBlocking.length > 0) {
  process.stdout.write(
    `${nonBlocking.length} non-blocking OSV finding(s): ${nonBlocking
      .map(
        (entry) =>
          `${entry.dependency.package.name}@${entry.dependency.version} ${entry.id}`,
      )
      .join(", ")}\n`,
  );
}
process.stdout.write(
  `OSV dependency audit passed (${queries.length} locked npm packages; no high, critical, or unknown-severity advisory).\n`,
);
