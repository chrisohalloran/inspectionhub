import { createHash } from "node:crypto";

import type { ReportModule, ReportSnapshot } from "../render/report-types.js";
import { reportSemanticFacts } from "../render/semantic-report.js";

type StyledLine = Readonly<{
  text: string;
  size: number;
  bold: boolean;
  spacingAfter: number;
  tag: "H1" | "H2" | "P";
}>;

export type PdfArtifact = Readonly<{
  reportVersionId: string;
  module: ReportModule;
  fileName: string;
  mediaType: "application/pdf";
  bytes: Uint8Array;
  contentHash: string;
  pageCount: number;
  requiredText: readonly string[];
}>;

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const LEFT = 54;
const TOP = 786;
const BOTTOM = 50;

export function generateModulePdf(
  snapshot: ReportSnapshot,
  module: ReportModule,
): PdfArtifact {
  if (
    (module === "building" && snapshot.building === null) ||
    (module === "timber_pest" && snapshot.timberPest === null)
  ) {
    throw new Error("Cannot render a PDF for an uncommissioned report module");
  }
  const requiredText = reportSemanticFacts(snapshot, module).map(
    normalisePdfText,
  );
  const headingTexts = new Set(
    (module === "building"
      ? snapshot.building?.findings
      : snapshot.timberPest?.findings
    )?.map(({ title }) => normalisePdfText(title)) ?? [],
  );
  const lines = styleAndWrap(requiredText, headingTexts);
  const pages = paginate(lines, snapshot, module);
  const bytes = buildPdf(
    pages,
    `${snapshot.propertyLabel} - ${moduleLabel(module)} report - version ${String(snapshot.versionNumber)}`,
    module,
  );
  const safeProperty = snapshot.propertyLabel
    .toLocaleLowerCase("en-AU")
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-|-$/gu, "")
    .slice(0, 48);
  return Object.freeze({
    reportVersionId: snapshot.reportVersionId,
    module,
    fileName: `${safeProperty}-${module.replaceAll("_", "-")}-report-v${String(snapshot.versionNumber)}.pdf`,
    mediaType: "application/pdf",
    bytes,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    pageCount: pages.length,
    requiredText: Object.freeze(requiredText),
  });
}

function styleAndWrap(
  facts: readonly string[],
  headingTexts: ReadonlySet<string>,
): readonly StyledLine[] {
  const lines: StyledLine[] = [];
  for (const [index, fact] of facts.entries()) {
    const h1 = index === 0;
    const h2 =
      fact === "Building report" ||
      fact === "Timber Pest report" ||
      fact === "Amendment notice" ||
      headingTexts.has(fact);
    const label =
      /^(?:Classification|Category|Location|Observation|Apparent extent|Significance|Qualified opinion|Further investigation|Uncertainty|Limitation|Effect on conclusion|Inspector|Credential|Reason)\b/u.test(
        fact,
      );
    const size = h1 ? 18 : h2 ? 14 : 10;
    const maxCharacters = h1 ? 48 : h2 ? 64 : 88;
    for (const [lineIndex, text] of wrapText(fact, maxCharacters).entries()) {
      lines.push({
        text,
        size,
        bold: h1 || h2 || (label && lineIndex === 0),
        spacingAfter:
          lineIndex === wrapText(fact, maxCharacters).length - 1
            ? h1
              ? 12
              : h2
                ? 8
                : 4
            : 1,
        tag: h1 ? "H1" : h2 ? "H2" : "P",
      });
    }
  }
  return lines;
}

function paginate(
  lines: readonly StyledLine[],
  snapshot: ReportSnapshot,
  module: ReportModule,
): readonly (readonly StyledLine[])[] {
  const pages: StyledLine[][] = [];
  let page: StyledLine[] = [];
  let y = TOP;
  for (const line of lines) {
    const height = line.size * 1.35 + line.spacingAfter;
    if (y - height < BOTTOM && page.length > 0) {
      pages.push(page);
      page = [
        {
          text: `${snapshot.propertyLabel} - ${moduleLabel(module)} report - version ${String(snapshot.versionNumber)}`,
          size: 9,
          bold: true,
          spacingAfter: 10,
          tag: "P",
        },
      ];
      y = TOP - 24;
    }
    page.push(line);
    y -= height;
  }
  if (page.length > 0) {
    pages.push(page);
  }
  return pages;
}

function buildPdf(
  pages: readonly (readonly StyledLine[])[],
  title: string,
  module: ReportModule,
): Uint8Array {
  const pageObjectNumbers = pages.map((_, index) => 6 + index * 2);
  const contentObjectNumbers = pages.map((_, index) => 7 + index * 2);
  const structureRootObject = 6 + pages.length * 2;
  const objects = new Map<number, string>();

  objects.set(
    1,
    `<< /Type /Catalog /Pages 2 0 R /Lang (en-AU) /MarkInfo << /Marked true >> /StructTreeRoot ${String(structureRootObject)} 0 R >>`,
  );
  objects.set(
    2,
    `<< /Type /Pages /Count ${String(pages.length)} /Kids [${pageObjectNumbers.map((value) => `${String(value)} 0 R`).join(" ")}] >>`,
  );
  objects.set(
    3,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );
  objects.set(
    4,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  );
  objects.set(
    5,
    `<< /Title (${escapePdfText(normalisePdfText(title))}) /Creator (InspectionHub semantic report renderer) /Producer (InspectionHub) >>`,
  );
  for (const [index, pageLines] of pages.entries()) {
    const pageObject = pageObjectNumbers[index];
    const contentObject = contentObjectNumbers[index];
    if (pageObject === undefined || contentObject === undefined) {
      throw new Error("PDF page object allocation failed");
    }
    const stream = buildPageStream(pageLines, index + 1, pages.length, module);
    objects.set(
      pageObject,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(PAGE_WIDTH)} ${String(PAGE_HEIGHT)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${String(contentObject)} 0 R /StructParents ${String(index)} >>`,
    );
    objects.set(
      contentObject,
      `<< /Length ${String(Buffer.byteLength(stream, "latin1"))} >>\nstream\n${stream}\nendstream`,
    );
  }
  objects.set(
    structureRootObject,
    "<< /Type /StructTreeRoot /K [] /RoleMap << /H1 /H1 /H2 /H2 /P /P >> >>",
  );

  const maxObject = structureRootObject;
  const chunks = ["%PDF-1.7\n%InspectionHub\n"];
  const offsets = new Array<number>(maxObject + 1).fill(0);
  let byteOffset = Buffer.byteLength(chunks[0] ?? "", "latin1");
  for (let objectNumber = 1; objectNumber <= maxObject; objectNumber += 1) {
    const body = objects.get(objectNumber);
    if (body === undefined) {
      throw new Error(`Missing PDF object ${String(objectNumber)}`);
    }
    offsets[objectNumber] = byteOffset;
    const chunk = `${String(objectNumber)} 0 obj\n${body}\nendobj\n`;
    chunks.push(chunk);
    byteOffset += Buffer.byteLength(chunk, "latin1");
  }
  const xrefOffset = byteOffset;
  const xref = [
    `xref\n0 ${String(maxObject + 1)}\n`,
    "0000000000 65535 f \n",
    ...offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${String(maxObject + 1)} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${String(xrefOffset)}\n%%EOF\n`,
  ].join("");
  chunks.push(xref);
  return new Uint8Array(Buffer.from(chunks.join(""), "latin1"));
}

function buildPageStream(
  lines: readonly StyledLine[],
  pageNumber: number,
  pageCount: number,
  module: ReportModule,
): string {
  let y = TOP;
  let mcid = 0;
  const moduleColour =
    module === "building" ? "0.090 0.306 0.514" : "0.396 0.294 0.125";
  const commands: string[] = [
    "q",
    "0.039 0.310 0.357 rg",
    `0 ${String(PAGE_HEIGHT - 26)} ${String(PAGE_WIDTH)} 26 re`,
    "f",
    "Q",
    "BT",
    "/F2 9 Tf",
    "1 1 1 rg",
    `1 0 0 1 ${String(LEFT)} ${String(PAGE_HEIGHT - 17)} Tm`,
    "(SEE IT INSPECTIONS - FORMAL RECORD) Tj",
    "ET",
  ];
  for (const line of lines) {
    const textColour = line.tag === "H2" ? moduleColour : "0.090 0.125 0.114";
    commands.push(
      `/${line.tag} << /MCID ${String(mcid)} >> BDC`,
      "BT",
      `/${line.bold ? "F2" : "F1"} ${String(line.size)} Tf`,
      `${textColour} rg`,
      `1 0 0 1 ${String(LEFT)} ${y.toFixed(2)} Tm`,
      `(${escapePdfText(line.text)}) Tj`,
      "ET",
      "EMC",
    );
    y -= line.size * 1.35 + line.spacingAfter;
    mcid += 1;
  }
  commands.push(
    "q",
    "0.333 0.408 0.380 RG",
    "0.5 w",
    `54 42 m ${String(PAGE_WIDTH - 54)} 42 l S`,
    "Q",
    "/P << /MCID 999 >> BDC",
    "BT",
    "/F1 8 Tf",
    "0.290 0.353 0.333 rg",
    `1 0 0 1 ${String(LEFT)} 26 Tm`,
    `(Page ${String(pageNumber)} of ${String(pageCount)}) Tj`,
    "ET",
    "EMC",
  );
  return commands.join("\n");
}

function wrapText(value: string, maxCharacters: number): readonly string[] {
  const words = value.split(/\s+/u);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > maxCharacters) {
      if (current.length > 0) {
        lines.push(current);
        current = "";
      }
      for (let index = 0; index < word.length; index += maxCharacters) {
        lines.push(word.slice(index, index + maxCharacters));
      }
      continue;
    }
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length > maxCharacters) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines.length === 0 ? [""] : lines;
}

export function normalisePdfText(value: string): string {
  return value
    .replaceAll(/[\u2010-\u2015\u2212]/gu, "-")
    .replaceAll(/[\u2018\u2019]/gu, "'")
    .replaceAll(/[\u201C\u201D]/gu, '"')
    .replaceAll("\u2026", "...")
    .replaceAll(/[^\u0020-\u007e\u00a0-\u00ff]/gu, "?");
}

function escapePdfText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function moduleLabel(module: ReportModule): string {
  return module === "building" ? "Building" : "Timber Pest";
}
