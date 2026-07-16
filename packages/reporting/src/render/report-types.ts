import { deepFreezeReport, hashCanonicalReport } from "./report-canonical.js";

export type ReportModule = "building" | "timber_pest";

export type ReportInspectorAttribution = Readonly<{
  displayName: string;
  credential: string;
  confirmedAt: string;
}>;

export type CuratedReportMedia = Readonly<{
  artifactId: string;
  contentHash: string;
  module: ReportModule;
  findingId: string;
  transformation: "safe_proxy" | "annotation" | "crop" | "caption_render";
  altText: string;
  caption: string;
}>;

type CommonReportFinding = Readonly<{
  findingId: string;
  title: string;
  location: string;
  observation: string;
  apparentExtent: string;
  significance: string;
  qualifiedOpinion: string;
  uncertainty: readonly string[];
  furtherInvestigation: string | null;
  inspector: ReportInspectorAttribution;
  curatedMedia: readonly CuratedReportMedia[];
}>;

export type BuildingReportFinding = CommonReportFinding &
  Readonly<{
    module: "building";
    classification:
      | "major_defect"
      | "minor_defect"
      | "safety_hazard"
      | "other_building_condition";
  }>;

export type TimberPestReportFinding = CommonReportFinding &
  Readonly<{
    module: "timber_pest";
    category:
      | "visible_evidence"
      | "timber_damage"
      | "conducive_condition"
      | "no_visible_evidence";
  }>;

export type ReportLimitation = Readonly<{
  limitationId: string;
  module: ReportModule;
  area: string;
  description: string;
  material: boolean;
  effectOnConclusion: string;
}>;

export type BuildingReportModule = Readonly<{
  module: "building";
  conclusion: string;
  minorDefectSummary: string;
  findings: readonly BuildingReportFinding[];
  limitations: readonly ReportLimitation[];
  inspector: ReportInspectorAttribution;
}>;

export type TimberPestReportModule = Readonly<{
  module: "timber_pest";
  conclusion: string;
  findings: readonly TimberPestReportFinding[];
  limitations: readonly ReportLimitation[];
  inspector: ReportInspectorAttribution;
}>;

export type ReportAmendmentNotice = Readonly<{
  priorReportVersionId: string;
  reason: string;
  changedAt: string;
  changedBy: string;
  changeNotice: string;
}>;

export type ReportSnapshotInput = Readonly<{
  schemaVersion: "recipient-report-v1";
  reportVersionId: string;
  versionNumber: number;
  organizationId: string;
  jobId: string;
  propertyLabel: string;
  inspectionDate: string;
  issuedAt: string;
  templateVersion: string;
  building: BuildingReportModule | null;
  timberPest: TimberPestReportModule | null;
  amendment: ReportAmendmentNotice | null;
}>;

export type ReportSnapshot = ReportSnapshotInput &
  Readonly<{ canonicalHash: string }>;

const PROHIBITED_RECIPIENT_LANGUAGE = [
  /\btermite[- ]free\b/iu,
  /\bpassed\b/iu,
  /\bsafe\b/iu,
  /\bgood condition\b/iu,
  /\b(buy|purchase decision)\b/iu,
  /\b(settlement|negotiat(?:e|ion|ing)|valuation|repair costs?)\b/iu,
  /\bAI (?:generated|suggestion|confidence|analysis)\b/iu,
];

export class ReportSnapshotValidationError extends Error {
  readonly code = "report_snapshot_invalid";

  constructor(message: string) {
    super(message);
    this.name = "ReportSnapshotValidationError";
  }
}

export function createReportSnapshot(
  input: ReportSnapshotInput,
): ReportSnapshot {
  validateReportSnapshotInput(input);
  return deepFreezeReport({
    ...input,
    canonicalHash: hashCanonicalReport(input),
  });
}

export function verifyReportSnapshotHash(snapshot: ReportSnapshot): boolean {
  const { canonicalHash, ...input } = snapshot;
  return canonicalHash === hashCanonicalReport(input);
}

export function validateReportSnapshotInput(input: ReportSnapshotInput): void {
  if (input.versionNumber < 1 || !Number.isInteger(input.versionNumber)) {
    throw new ReportSnapshotValidationError(
      "Report version number must be a positive integer",
    );
  }
  for (const [field, value] of [
    ["reportVersionId", input.reportVersionId],
    ["organizationId", input.organizationId],
    ["jobId", input.jobId],
    ["propertyLabel", input.propertyLabel],
    ["templateVersion", input.templateVersion],
  ] as const) {
    assertPlainText(value, field);
  }
  assertTimestamp(input.inspectionDate, "inspectionDate");
  assertTimestamp(input.issuedAt, "issuedAt");
  if (input.building === null && input.timberPest === null) {
    throw new ReportSnapshotValidationError(
      "A report version requires at least one commissioned module",
    );
  }
  if (input.building !== null) {
    validateBuildingModule(input.building);
  }
  if (input.timberPest !== null) {
    validateTimberPestModule(input.timberPest);
  }
  if (input.amendment !== null) {
    assertPlainText(
      input.amendment.priorReportVersionId,
      "priorReportVersionId",
    );
    assertPlainText(input.amendment.reason, "amendment reason");
    assertPlainText(input.amendment.changedBy, "amendment author");
    assertPlainText(input.amendment.changeNotice, "amendment notice");
    assertTimestamp(input.amendment.changedAt, "amendment changedAt");
    if (input.amendment.priorReportVersionId === input.reportVersionId) {
      throw new ReportSnapshotValidationError(
        "An amendment cannot replace itself",
      );
    }
  }
}

function validateBuildingModule(module: BuildingReportModule): void {
  assertPlainText(module.conclusion, "Building conclusion");
  assertPlainText(module.minorDefectSummary, "minor defect summary");
  validateInspector(module.inspector);
  for (const finding of module.findings) {
    if (finding.module !== "building") {
      throw new ReportSnapshotValidationError(
        "A Building report cannot contain another module's finding",
      );
    }
    validateFinding(finding);
  }
  validateLimitations(module.limitations, "building");
}

function validateTimberPestModule(module: TimberPestReportModule): void {
  assertPlainText(module.conclusion, "Timber Pest conclusion");
  validateInspector(module.inspector);
  for (const finding of module.findings) {
    if (finding.module !== "timber_pest") {
      throw new ReportSnapshotValidationError(
        "A Timber Pest report cannot contain another module's finding",
      );
    }
    validateFinding(finding);
    if (
      finding.category === "no_visible_evidence" &&
      !isBoundedNoVisibleStatement(
        `${finding.observation} ${finding.qualifiedOpinion} ${module.conclusion}`,
      )
    ) {
      throw new ReportSnapshotValidationError(
        "No-visible-pest language must be bounded to accessible areas and the inspection time",
      );
    }
  }
  validateLimitations(module.limitations, "timber_pest");
}

function validateFinding(
  finding: BuildingReportFinding | TimberPestReportFinding,
): void {
  for (const [field, value] of [
    ["findingId", finding.findingId],
    ["title", finding.title],
    ["location", finding.location],
    ["observation", finding.observation],
    ["apparentExtent", finding.apparentExtent],
    ["significance", finding.significance],
    ["qualifiedOpinion", finding.qualifiedOpinion],
  ] as const) {
    assertPlainText(value, `${finding.findingId}.${field}`);
  }
  for (const uncertainty of finding.uncertainty) {
    assertPlainText(uncertainty, `${finding.findingId}.uncertainty`);
  }
  if (finding.furtherInvestigation !== null) {
    assertPlainText(
      finding.furtherInvestigation,
      `${finding.findingId}.furtherInvestigation`,
    );
  }
  validateInspector(finding.inspector);
  const mediaIds = new Set<string>();
  for (const media of finding.curatedMedia) {
    if (
      media.module !== finding.module ||
      media.findingId !== finding.findingId
    ) {
      throw new ReportSnapshotValidationError(
        "Curated media must remain scoped to its report finding and module",
      );
    }
    if (mediaIds.has(media.artifactId)) {
      throw new ReportSnapshotValidationError(
        "A curated media item cannot appear twice in one finding",
      );
    }
    mediaIds.add(media.artifactId);
    assertPlainText(media.altText, `${media.artifactId}.altText`);
    assertPlainText(media.caption, `${media.artifactId}.caption`);
    if (!/^[a-f0-9]{64}$/u.test(media.contentHash)) {
      throw new ReportSnapshotValidationError(
        "Curated media requires a verified SHA-256 content hash",
      );
    }
  }
}

function validateLimitations(
  limitations: readonly ReportLimitation[],
  module: ReportModule,
): void {
  for (const limitation of limitations) {
    if (limitation.module !== module) {
      throw new ReportSnapshotValidationError(
        "A limitation cannot cross professional modules",
      );
    }
    assertPlainText(limitation.area, `${limitation.limitationId}.area`);
    assertPlainText(
      limitation.description,
      `${limitation.limitationId}.description`,
    );
    assertPlainText(
      limitation.effectOnConclusion,
      `${limitation.limitationId}.effectOnConclusion`,
    );
  }
}

function validateInspector(inspector: ReportInspectorAttribution): void {
  assertPlainText(inspector.displayName, "inspector display name");
  assertPlainText(inspector.credential, "inspector credential");
  assertTimestamp(inspector.confirmedAt, "inspector confirmation time");
}

function assertTimestamp(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new ReportSnapshotValidationError(
      `${field} must be an ISO timestamp`,
    );
  }
}

function assertPlainText(value: string, field: string): void {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 4_000) {
    throw new ReportSnapshotValidationError(
      `${field} must contain bounded plain text`,
    );
  }
  if (value.includes("\u0000")) {
    throw new ReportSnapshotValidationError(`${field} contains invalid text`);
  }
  const prohibited = PROHIBITED_RECIPIENT_LANGUAGE.find((pattern) =>
    pattern.test(value),
  );
  if (prohibited !== undefined) {
    throw new ReportSnapshotValidationError(
      `${field} contains prohibited recipient-facing language`,
    );
  }
}

function isBoundedNoVisibleStatement(value: string): boolean {
  return (
    /\baccessible (?:areas|locations|elements)\b/iu.test(value) &&
    /\b(?:at the )?(?:inspection time|time of (?:the )?inspection|inspection date)\b/iu.test(
      value,
    )
  );
}
