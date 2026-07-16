import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const forbidden = [
  {
    pattern: /SUPABASE_SERVICE_ROLE_KEY\s*=\s*[^\s#]+/u,
    name: "service-role secret",
  },
  { pattern: /sk-(?:live|proj)-[A-Za-z0-9_-]{12,}/u, name: "provider secret" },
  {
    pattern: /console\.(?:log|debug)\s*\(/u,
    name: "unstructured console logging",
  },
];
const extensions = new Set([
  ".ts",
  ".tsx",
  ".mjs",
  ".json",
  ".toml",
  ".yml",
  ".yaml",
]);
const ignored = new Set([
  ".git",
  ".next",
  ".turbo",
  "artifacts",
  "dist",
  "node_modules",
]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(absolute)));
    else if (extensions.has(path.extname(entry.name))) files.push(absolute);
  }
  return files;
}

const findings = [];
for (const file of await walk(root)) {
  if (file.endsWith("check-repository.mjs") || file.endsWith(".env.example"))
    continue;
  const content = await readFile(file, "utf8");
  for (const rule of forbidden) {
    if (rule.pattern.test(content))
      findings.push(`${path.relative(root, file)}: ${rule.name}`);
  }
}

if (findings.length > 0) {
  process.stderr.write(
    `Repository quality check failed:\n${findings.join("\n")}\n`,
  );
  process.exit(1);
}

process.stdout.write("Repository quality check passed.\n");
