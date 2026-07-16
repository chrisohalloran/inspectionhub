import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createReportSnapshot,
  createSyntheticRecipientReport,
  generateModulePdf,
} from "../../packages/reporting/dist/index.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const outputDirectory = path.join(root, "tmp/pdfs/u9");
const baselinePath = path.join(root, "tests/pdf/baselines.json");

rmSync(outputDirectory, { force: true, recursive: true });
mkdirSync(outputDirectory, { recursive: true });

const cracked = createSyntheticRecipientReport();
const crackedInput = reportInput(cracked);
const noMajor = createReportSnapshot({
  ...crackedInput,
  reportVersionId: "report_demo_no_major",
  amendment: null,
  versionNumber: 1,
  building: {
    ...crackedInput.building,
    findings: crackedInput.building.findings.filter(
      ({ classification }) => classification !== "major_defect",
    ),
    conclusion:
      "No major Building defects were identified in the accessible areas at the inspection time. Several minor defects are described below.",
  },
});

const fixtures = [
  { name: "cracked-tile-building", snapshot: cracked, module: "building" },
  {
    name: "cracked-tile-timber-pest",
    snapshot: cracked,
    module: "timber_pest",
  },
  { name: "no-major-defect", snapshot: noMajor, module: "building" },
  { name: "access-limitation", snapshot: cracked, module: "timber_pest" },
];

const versionResult = spawnSync("pdftoppm", ["-v"], {
  encoding: "utf8",
});
const popplerVersion = `${versionResult.stdout}${versionResult.stderr}`
  .trim()
  .split("\n")[0];
const results = [];

for (const fixture of fixtures) {
  const artifact = generateModulePdf(fixture.snapshot, fixture.module);
  const pdfPath = path.join(outputDirectory, `${fixture.name}.pdf`);
  writeFileSync(pdfPath, artifact.bytes);

  const info = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  assertMatch(info, /^Pages:\s+\d+$/mu, `${fixture.name}: page count missing`);
  assertMatch(
    info,
    /^Page size:\s+595 x 842 pts \(A4\)$/mu,
    `${fixture.name}: expected A4 page size`,
  );
  assertMatch(info, /^Tagged:\s+yes$/mu, `${fixture.name}: PDF is not marked`);

  const textPath = path.join(outputDirectory, `${fixture.name}.txt`);
  execFileSync("pdftotext", ["-layout", pdfPath, textPath]);
  const extracted = normalise(readFileSync(textPath, "utf8"));
  for (const required of artifact.requiredText) {
    if (!extracted.includes(normalise(required))) {
      throw new Error(
        `${fixture.name}: PDF/semantic parity lost required text: ${required}`,
      );
    }
  }
  for (const prohibited of [
    "coverage_private",
    "termite-free",
    "property score",
    "traffic light",
    "ai confidence",
    "do not buy",
    "don't buy",
  ]) {
    if (extracted.includes(prohibited)) {
      throw new Error(`${fixture.name}: prohibited text found: ${prohibited}`);
    }
  }

  const imagePrefix = path.join(outputDirectory, `${fixture.name}-page`);
  execFileSync("pdftoppm", ["-png", "-r", "144", pdfPath, imagePrefix], {
    stdio: "pipe",
  });
  const pageImages = readdirSync(outputDirectory)
    .filter(
      (fileName) =>
        fileName.startsWith(`${fixture.name}-page-`) &&
        fileName.endsWith(".png"),
    )
    .toSorted();
  if (pageImages.length !== artifact.pageCount || pageImages.length === 0) {
    throw new Error(`${fixture.name}: raster page count does not match PDF`);
  }
  const imageHashes = pageImages.map((fileName) =>
    sha256(readFileSync(path.join(outputDirectory, fileName))),
  );
  results.push({
    fixture: fixture.name,
    module: fixture.module,
    reportVersionId: artifact.reportVersionId,
    pageCount: artifact.pageCount,
    pdfHash: sha256(readFileSync(pdfPath)),
    imageHashes,
    requiredTextCount: artifact.requiredText.length,
  });
}

const observed = { popplerVersion, fixtures: results };
if (existsSync(baselinePath) && process.env.PDF_BASELINE_SKIP !== "true") {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  for (const result of results) {
    const expected = baseline.fixtures.find(
      ({ fixture }) => fixture === result.fixture,
    );
    if (expected === undefined) {
      throw new Error(`${result.fixture}: visual baseline is missing`);
    }
    if (expected.pdfHash !== result.pdfHash) {
      throw new Error(`${result.fixture}: immutable PDF baseline changed`);
    }
    if (
      baseline.popplerVersion === popplerVersion &&
      JSON.stringify(expected.imageHashes) !==
        JSON.stringify(result.imageHashes)
    ) {
      throw new Error(`${result.fixture}: raster visual baseline changed`);
    }
  }
}

writeFileSync(
  path.join(outputDirectory, "manifest.json"),
  `${JSON.stringify(observed, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(observed, null, 2)}\n`);

function reportInput(snapshot) {
  const copy = { ...snapshot };
  Reflect.deleteProperty(copy, "canonicalHash");
  return copy;
}

function normalise(value) {
  return value.toLocaleLowerCase("en-AU").replaceAll(/\s+/gu, " ").trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertMatch(value, pattern, message) {
  if (!pattern.test(value)) {
    throw new Error(message);
  }
}
