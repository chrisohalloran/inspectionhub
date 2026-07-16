import type {
  BuildingReportFinding,
  ReportLimitation,
  ReportModule,
  ReportSnapshot,
  TimberPestReportFinding,
} from "./report-types.js";
import { verifyReportSnapshotHash } from "./report-types.js";

export type ConditionOverview = Readonly<{
  majorBuildingFindings: readonly Readonly<{
    findingId: string;
    title: string;
    location: string;
  }>[];
  majorBuildingSummary: string;
  minorBuildingSummary: string | null;
  timberPestSummary: string | null;
  materialLimitations: readonly ReportLimitation[];
}>;

export function buildConditionOverview(
  snapshot: ReportSnapshot,
): ConditionOverview {
  assertValidHash(snapshot);
  const majorBuildingFindings =
    snapshot.building?.findings
      .filter(({ classification }) => classification === "major_defect")
      .map(({ findingId, title, location }) => ({
        findingId,
        title,
        location,
      })) ?? [];
  return {
    majorBuildingFindings,
    majorBuildingSummary:
      majorBuildingFindings.length === 0
        ? "No major Building defects were identified in the accessible areas at the inspection time."
        : `${String(majorBuildingFindings.length)} major Building ${majorBuildingFindings.length === 1 ? "defect" : "defects"} identified.`,
    minorBuildingSummary: snapshot.building?.minorDefectSummary ?? null,
    timberPestSummary: snapshot.timberPest?.conclusion ?? null,
    materialLimitations: [
      ...(snapshot.building?.limitations ?? []),
      ...(snapshot.timberPest?.limitations ?? []),
    ].filter(({ material }) => material),
  };
}

export function reportSemanticFacts(
  snapshot: ReportSnapshot,
  module?: ReportModule,
): readonly string[] {
  assertValidHash(snapshot);
  const facts = [
    snapshot.propertyLabel,
    `Report version ${String(snapshot.versionNumber)}`,
    `Inspection date ${formatDate(snapshot.inspectionDate)}`,
    `Issued ${formatDate(snapshot.issuedAt)}`,
  ];
  if ((module === undefined || module === "building") && snapshot.building) {
    facts.push(
      "Building report",
      snapshot.building.conclusion,
      snapshot.building.minorDefectSummary,
      ...snapshot.building.findings.flatMap(findingFacts),
      ...snapshot.building.limitations.flatMap(limitationFacts),
      `Inspector ${snapshot.building.inspector.displayName}`,
      `Credential ${snapshot.building.inspector.credential}`,
    );
  }
  if (
    (module === undefined || module === "timber_pest") &&
    snapshot.timberPest
  ) {
    facts.push(
      "Timber Pest report",
      snapshot.timberPest.conclusion,
      ...snapshot.timberPest.findings.flatMap(findingFacts),
      ...snapshot.timberPest.limitations.flatMap(limitationFacts),
      `Inspector ${snapshot.timberPest.inspector.displayName}`,
      `Credential ${snapshot.timberPest.inspector.credential}`,
    );
  }
  if (snapshot.amendment !== null) {
    facts.push(
      "Amendment notice",
      snapshot.amendment.changeNotice,
      `Reason ${snapshot.amendment.reason}`,
    );
  }
  return facts;
}

export function reportToPlainText(
  snapshot: ReportSnapshot,
  module?: ReportModule,
): string {
  return reportSemanticFacts(snapshot, module).join("\n");
}

export function renderReportToSemanticHtml(snapshot: ReportSnapshot): string {
  assertValidHash(snapshot);
  const overview = buildConditionOverview(snapshot);
  const amendment =
    snapshot.amendment === null
      ? ""
      : `<aside aria-labelledby="amendment-heading"><h2 id="amendment-heading">Amendment notice</h2><p>${escapeHtml(snapshot.amendment.changeNotice)}</p><p><strong>Reason:</strong> ${escapeHtml(snapshot.amendment.reason)}</p></aside>`;
  const building =
    snapshot.building === null
      ? ""
      : `<section id="building" aria-labelledby="building-heading"><p>Building report</p><h2 id="building-heading">Building condition</h2><p>${escapeHtml(snapshot.building.conclusion)}</p>${snapshot.building.findings
          .toSorted(buildingFindingOrder)
          .map(renderFinding)
          .join(
            "",
          )}${renderLimitations(snapshot.building.limitations)}<p>Inspector ${escapeHtml(snapshot.building.inspector.displayName)}</p><p>Credential ${escapeHtml(snapshot.building.inspector.credential)}</p></section>`;
  const timberPest =
    snapshot.timberPest === null
      ? ""
      : `<section id="timber-pest" aria-labelledby="timber-pest-heading"><p>Timber Pest report</p><h2 id="timber-pest-heading">Timber Pest condition</h2><p>${escapeHtml(snapshot.timberPest.conclusion)}</p>${snapshot.timberPest.findings
          .map(renderFinding)
          .join(
            "",
          )}${renderLimitations(snapshot.timberPest.limitations)}<p>Inspector ${escapeHtml(snapshot.timberPest.inspector.displayName)}</p><p>Credential ${escapeHtml(snapshot.timberPest.inspector.credential)}</p></section>`;
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><title>${escapeHtml(snapshot.propertyLabel)} - report version ${String(snapshot.versionNumber)}</title></head><body><main><header><p>Property condition report</p><h1>${escapeHtml(snapshot.propertyLabel)}</h1><p>Report version ${String(snapshot.versionNumber)}</p><p>Inspection date ${escapeHtml(formatDate(snapshot.inspectionDate))}</p><p>Issued ${escapeHtml(formatDate(snapshot.issuedAt))}</p></header>${amendment}<nav aria-label="Report modules"><a href="#overview">Condition overview</a>${snapshot.building ? '<a href="#building">Building</a>' : ""}${snapshot.timberPest ? '<a href="#timber-pest">Timber Pest</a>' : ""}</nav><section id="overview" aria-labelledby="overview-heading"><h2 id="overview-heading">Condition overview</h2><p>${escapeHtml(overview.majorBuildingSummary)}</p>${overview.majorBuildingFindings.length === 0 ? "" : `<ul>${overview.majorBuildingFindings.map((finding) => `<li><a href="#finding-${escapeAttribute(finding.findingId)}">${escapeHtml(finding.title)}</a> - ${escapeHtml(finding.location)}</li>`).join("")}</ul>`}${overview.minorBuildingSummary ? `<p>${escapeHtml(overview.minorBuildingSummary)}</p>` : ""}${overview.timberPestSummary ? `<p>${escapeHtml(overview.timberPestSummary)}</p>` : ""}${renderLimitations(overview.materialLimitations)}</section>${building}${timberPest}</main></body></html>`;
}

function findingFacts(
  finding: BuildingReportFinding | TimberPestReportFinding,
): string[] {
  const category =
    finding.module === "building"
      ? `Classification ${buildingClassificationLabel(finding.classification)}`
      : `Category ${timberPestCategoryLabel(finding.category)}`;
  return [
    finding.title,
    `Location ${finding.location}`,
    category,
    `Observation ${finding.observation}`,
    `Apparent extent ${finding.apparentExtent}`,
    `Significance ${finding.significance}`,
    `Qualified opinion ${finding.qualifiedOpinion}`,
    ...finding.uncertainty.map((value) => `Uncertainty ${value}`),
    ...(finding.furtherInvestigation === null
      ? []
      : [`Further investigation ${finding.furtherInvestigation}`]),
    ...finding.curatedMedia.flatMap(({ altText, caption }) => [
      `Evidence ${altText}`,
      `Caption ${caption}`,
    ]),
    `Inspector ${finding.inspector.displayName}`,
  ];
}

function limitationFacts(limitation: ReportLimitation): string[] {
  return [
    `Limitation ${limitation.area}: ${limitation.description}`,
    `Effect on conclusion ${limitation.effectOnConclusion}`,
  ];
}

function renderFinding(
  finding: BuildingReportFinding | TimberPestReportFinding,
): string {
  const category =
    finding.module === "building"
      ? `<p><strong>Classification:</strong> ${escapeHtml(buildingClassificationLabel(finding.classification))}</p>`
      : `<p><strong>Category:</strong> ${escapeHtml(timberPestCategoryLabel(finding.category))}</p>`;
  const investigation =
    finding.furtherInvestigation === null
      ? ""
      : `<p><strong>Further investigation:</strong> ${escapeHtml(finding.furtherInvestigation)}</p>`;
  const uncertainty =
    finding.uncertainty.length === 0
      ? ""
      : `<h4>Uncertainty</h4><ul>${finding.uncertainty.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`;
  const media =
    finding.curatedMedia.length === 0
      ? ""
      : `<div aria-label="Curated evidence">${finding.curatedMedia.map((item) => `<figure><img src="/api/media/${escapeAttribute(item.artifactId)}" alt="${escapeAttribute(item.altText)}"><figcaption>${escapeHtml(item.caption)}</figcaption></figure>`).join("")}</div>`;
  return `<article id="finding-${escapeAttribute(finding.findingId)}"><p>${finding.module === "building" ? "Building" : "Timber Pest"} report</p><h3>${escapeHtml(finding.title)}</h3><p><strong>Location:</strong> ${escapeHtml(finding.location)}</p>${category}<p><strong>Observation:</strong> ${escapeHtml(finding.observation)}</p><p><strong>Apparent extent:</strong> ${escapeHtml(finding.apparentExtent)}</p><p><strong>Significance:</strong> ${escapeHtml(finding.significance)}</p><p><strong>Qualified opinion:</strong> ${escapeHtml(finding.qualifiedOpinion)}</p>${uncertainty}${investigation}${media}<p><strong>Inspector:</strong> ${escapeHtml(finding.inspector.displayName)}</p></article>`;
}

function renderLimitations(limitations: readonly ReportLimitation[]): string {
  if (limitations.length === 0) {
    return "";
  }
  return `<section aria-label="Inspection limitations"><h3>Inspection limitations</h3><ul>${limitations.map((limitation) => `<li><p>Limitation <strong>${escapeHtml(limitation.area)}:</strong> ${escapeHtml(limitation.description)}</p><p><strong>Effect on conclusion:</strong> ${escapeHtml(limitation.effectOnConclusion)}</p></li>`).join("")}</ul></section>`;
}

function buildingFindingOrder(
  left: BuildingReportFinding,
  right: BuildingReportFinding,
): number {
  const order = {
    major_defect: 0,
    safety_hazard: 1,
    minor_defect: 2,
    other_building_condition: 3,
  } as const;
  return order[left.classification] - order[right.classification];
}

export function buildingClassificationLabel(
  value: BuildingReportFinding["classification"],
): string {
  return {
    major_defect: "Major defect",
    minor_defect: "Minor defect",
    safety_hazard: "Safety hazard",
    other_building_condition: "Other Building condition",
  }[value];
}

export function timberPestCategoryLabel(
  value: TimberPestReportFinding["category"],
): string {
  return {
    visible_evidence: "Visible evidence",
    timber_damage: "Timber damage",
    conducive_condition: "Conducive condition",
    no_visible_evidence:
      "No visible evidence in accessible areas at the inspection time",
  }[value];
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "long",
    timeZone: "Australia/Brisbane",
  }).format(new Date(value));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function assertValidHash(snapshot: ReportSnapshot): void {
  if (!verifyReportSnapshotHash(snapshot)) {
    throw new Error(
      "Report snapshot hash does not match its immutable content",
    );
  }
}
