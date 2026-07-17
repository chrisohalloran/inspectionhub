import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  ".expo",
  "artifacts",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "Pods",
  "test-results",
]);
const textExtensions = new Set([
  ".env",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(absolute)));
    else if (
      entry.name.startsWith(".env") ||
      textExtensions.has(path.extname(entry.name))
    ) {
      files.push(absolute);
    }
  }
  return files;
}

const secretRules = [
  {
    name: "private key material",
    pattern: new RegExp(["-----BEGIN ", "PRIVATE KEY-----"].join(""), "u"),
  },
  {
    name: "OpenAI credential",
    pattern: new RegExp(
      ["sk-", "(?:proj-|live-)?[A-Za-z0-9_-]{20,}"].join(""),
      "u",
    ),
  },
  {
    name: "Stripe live credential",
    pattern: new RegExp(["(?:sk|rk)_", "live_[A-Za-z0-9]{16,}"].join(""), "u"),
  },
  {
    name: "Supabase service-role assignment",
    pattern: new RegExp(
      [
        "SUPABASE_SERVICE_ROLE_",
        "KEY\\s*=\\s*(?!replace-with|<|$)[A-Za-z0-9._~+/-]{8,}",
      ].join(""),
      "u",
    ),
  },
  {
    name: "JWT credential",
    pattern: new RegExp(
      [
        "\\beyJ",
        "[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\b",
      ].join(""),
      "u",
    ),
  },
];

const productionSinkRules = [
  { name: "React raw HTML sink", pattern: /dangerouslySetInnerHTML\s*=/u },
  { name: "DOM raw HTML assignment", pattern: /\.innerHTML\s*=/u },
  { name: "document.write sink", pattern: /document\.write\s*\(/u },
  { name: "dynamic eval", pattern: /\beval\s*\(/u },
  { name: "dynamic Function constructor", pattern: /new\s+Function\s*\(/u },
  {
    name: "wildcard CORS",
    pattern: /Access-Control-Allow-Origin["']?\s*[:,]\s*["']\*["']/u,
  },
  {
    name: "publicly exposed privileged environment variable",
    pattern:
      /NEXT_PUBLIC_[A-Z0-9_]*(?:SERVICE_ROLE|SECRET|PASSWORD|PRIVATE|OPENAI|STRIPE_SK|TOKEN)/u,
  },
];

const findings = [];
for (const file of await walk(root)) {
  const relative = path.relative(root, file);
  const content = await readFile(file, "utf8");
  const isScanner = relative.startsWith("scripts/security-check/");
  const baseName = path.basename(file);
  const isProductionSource =
    /^(apps|packages)\//u.test(relative) &&
    !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(relative) &&
    !relative.includes("/fixtures/");

  if (!isScanner) {
    for (const rule of secretRules) {
      if (rule.pattern.test(content))
        findings.push(`${relative}: ${rule.name}`);
    }
  }
  if (baseName.startsWith(".env") && baseName !== ".env.example") {
    findings.push(`${relative}: repository environment file`);
  }
  if (isProductionSource) {
    for (const rule of productionSinkRules) {
      if (rule.pattern.test(content))
        findings.push(`${relative}: ${rule.name}`);
    }
  }
}

const scannerSelfTests = [
  {
    name: "JWT credential",
    value: [
      "eyJhbGciOiJIUzI1NiJ9",
      "eyJzdWIiOiJzZWxmLXRlc3QifQ",
      "synthetic_signature_12345",
    ].join("."),
  },
];
for (const sample of scannerSelfTests) {
  const rule = secretRules.find((candidate) => candidate.name === sample.name);
  if (!rule?.pattern.test(sample.value)) {
    findings.push(
      `security scanner self-test: ${sample.name} was not detected`,
    );
  }
}

const proxy = await readFile(path.join(root, "apps/web/proxy.ts"), "utf8");
const requiredProxyControls = [
  ["per-response nonce", "crypto.randomUUID"],
  ["request nonce propagation", 'requestHeaders.set("x-nonce", nonce)'],
  ["content security policy", '"Content-Security-Policy"'],
  [
    "strict script policy",
    "script-src 'self' 'nonce-${nonce}' 'strict-dynamic'",
  ],
  ["object embedding denial", "object-src 'none'"],
  ["framing denial", "frame-ancestors 'none'"],
  ["base URI restriction", "base-uri 'self'"],
];
for (const [name, needle] of requiredProxyControls) {
  if (!proxy.includes(needle))
    findings.push(`apps/web/proxy.ts: missing ${name}`);
}
const scriptDirective = proxy.match(/script-src[^"\n]*/u)?.[0] ?? "";
if (
  scriptDirective.includes("unsafe-inline") ||
  scriptDirective.includes("unsafe-eval")
) {
  findings.push("apps/web/proxy.ts: script policy permits unsafe execution");
}

function stringLiterals(source, declaration) {
  const block = source.match(
    new RegExp(
      `export const ${declaration} = \\[([\\s\\S]*?)\\] as const`,
      "u",
    ),
  )?.[1];
  if (!block) return null;
  return [...block.matchAll(/"([a-z][a-z0-9_]*)"/gu)].map((match) => match[1]);
}

function sqlCheckLiterals(source, columnName) {
  const block = source.match(
    new RegExp(
      `(?:${columnName} text not null )?check \\(${columnName} in \\(([\\s\\S]*?)\\)\\)`,
      "u",
    ),
  )?.[1];
  if (!block) return null;
  return [...block.matchAll(/'([a-z][a-z0-9_]*)'/gu)].map((match) => match[1]);
}

function integerObjectLiterals(source, declaration) {
  const block = source.match(
    new RegExp(
      `const ${declaration} = Object\\.freeze\\(\\{([\\s\\S]*?)\\}\\)`,
      "u",
    ),
  )?.[1];
  if (!block) return null;
  return [...block.matchAll(/([a-z][a-z0-9_]*):\s*(\d+)/gu)].map(
    (match) => `${match[1]}:${match[2]}`,
  );
}

const authorizationSource = await readFile(
  path.join(root, "packages/security/src/authorization.ts"),
  "utf8",
);
const restoreSource = await readFile(
  path.join(root, "packages/security/src/restore.ts"),
  "utf8",
);
const rateLimitSource = await readFile(
  path.join(root, "packages/security/src/rate-limit.ts"),
  "utf8",
);
const rateLimitFixtureSource = await readFile(
  path.join(root, "e2e/web/rate-limit-fixture-server.mjs"),
  "utf8",
);
const securityMigration = await readFile(
  path.join(
    root,
    "supabase/migrations/20260715000700_u10_security_operations.sql",
  ),
  "utf8",
);
const recipientDemoBoundsMigration = await readFile(
  path.join(
    root,
    "supabase/migrations/20260717001000_recipient_demo_public_bounds.sql",
  ),
  "utf8",
);
const applicationActions = stringLiterals(
  authorizationSource,
  "PRIVILEGED_ACTIONS",
);
const databaseActions = sqlCheckLiterals(securityMigration, "action_name");
const applicationRestoreChecks = stringLiterals(
  restoreSource,
  "RESTORE_CHECK_NAMES",
);
const databaseRestoreChecks = sqlCheckLiterals(securityMigration, "check_name");
const applicationRateLimitPolicies = stringLiterals(
  rateLimitSource,
  "RATE_LIMIT_POLICIES",
);
const databaseRateLimitPolicies = sqlCheckLiterals(
  recipientDemoBoundsMigration,
  "policy_name",
);
const applicationRateLimitEntries = integerObjectLiterals(
  rateLimitSource,
  "policyLimits",
);
const fixtureRateLimitEntries = integerObjectLiterals(
  rateLimitFixtureSource,
  "limits",
);

for (const [name, applicationValues, databaseValues] of [
  ["privileged action", applicationActions, databaseActions],
  ["restore check", applicationRestoreChecks, databaseRestoreChecks],
  [
    "rate-limit policy",
    applicationRateLimitPolicies,
    databaseRateLimitPolicies,
  ],
]) {
  if (
    applicationValues === null ||
    databaseValues === null ||
    JSON.stringify([...applicationValues].sort()) !==
      JSON.stringify([...databaseValues].sort())
  ) {
    findings.push(
      `security contract: ${name} vocabulary differs between TypeScript and Postgres`,
    );
  }
}

if (
  applicationRateLimitEntries === null ||
  fixtureRateLimitEntries === null ||
  JSON.stringify([...applicationRateLimitEntries].sort()) !==
    JSON.stringify([...fixtureRateLimitEntries].sort())
) {
  findings.push(
    "security contract: rate-limit fixture limits differ from TypeScript",
  );
}

if (findings.length > 0) {
  process.stderr.write(
    `Static security check failed:\n${findings.join("\n")}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  "Static security check passed (recursive env/JWT secrets, unsafe sinks, public env and CSP).\n",
);
