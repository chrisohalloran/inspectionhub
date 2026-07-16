import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const gate = process.argv[2];
const registry = JSON.parse(
  await readFile(new URL("./gates.json", import.meta.url), "utf8"),
);
const configuration = registry[gate];

if (!configuration) {
  process.stderr.write(`Unknown verification gate: ${gate ?? "<missing>"}\n`);
  process.exit(2);
}

if (configuration.status !== "active") {
  process.stderr.write(
    `${gate} is not active yet; ${configuration.unit} must replace the planned gate with ${configuration.command}.\n`,
  );
  process.exit(3);
}

if (
  !Array.isArray(configuration.command) ||
  configuration.command.length === 0
) {
  process.stderr.write(
    `${gate} is marked active but has no executable command.\n`,
  );
  process.exit(4);
}

const [executable, ...arguments_] = configuration.command;
const result = spawnSync(executable, arguments_, {
  stdio: "inherit",
  env: process.env,
});
if (result.error) {
  process.stderr.write(`${gate} could not start: ${result.error.message}\n`);
  process.exit(4);
}
process.exit(result.status ?? 1);
