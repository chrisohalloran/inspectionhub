import {
  buildConditionOverview,
  buildingClassificationLabel,
  createSyntheticRecipientReport,
  timberPestCategoryLabel,
} from "@inspection/reporting/web";

import type { demoPortalState, PortalSession } from "../_lib/recipient-session";
import { ContactInspector } from "./contact-inspector";
import { EndReportAccess } from "./end-report-access";
import styles from "./report.module.css";
import { ShareAccess } from "./share-access";

const dateFormatter = new Intl.DateTimeFormat("en-AU", {
  dateStyle: "long",
  timeZone: "Australia/Brisbane",
});

export function DemoReportContent({
  portalState,
  session,
}: Readonly<{
  portalState: Awaited<ReturnType<typeof demoPortalState>>;
  session: PortalSession;
}>) {
  const snapshot = createSyntheticRecipientReport();
  const overview = buildConditionOverview(snapshot);
  const buildingGranted = session.modules.includes("building");
  const timberPestGranted = session.modules.includes("timber_pest");
  const buildingAvailable = buildingGranted && !portalState.buildingWithdrawn;
  const timberPestAvailable =
    timberPestGranted && !portalState.timberPestWithdrawn;
  const availableModules = [
    ...(buildingAvailable ? (["building"] as const) : []),
    ...(timberPestAvailable ? (["timber_pest"] as const) : []),
  ];
  const building = snapshot.building!;
  const timberPest = snapshot.timberPest!;

  return (
    <main className={styles.page}>
      <a className={styles.skipLink} href="#report-content">
        Skip to report content
      </a>
      <header className={styles.reportHeader}>
        <div className={styles.headerInner}>
          <p className={styles.eyebrow}>See It Inspections</p>
          <h1>{snapshot.propertyLabel}</h1>
          <p className={styles.meta}>
            <span>Report version {snapshot.versionNumber}</span>
            <time dateTime={snapshot.inspectionDate}>
              Inspected{" "}
              {dateFormatter.format(new Date(snapshot.inspectionDate))}
            </time>
            <time dateTime={snapshot.issuedAt}>
              Issued {dateFormatter.format(new Date(snapshot.issuedAt))}
            </time>
          </p>
        </div>
      </header>

      <nav className={styles.moduleNav} aria-label="Report sections">
        <ul>
          <li>
            <a href="#overview">Summary</a>
          </li>
          {buildingAvailable ? (
            <li>
              <a href="#building">Building</a>
            </li>
          ) : null}
          {timberPestAvailable ? (
            <li>
              <a href="#timber-pest">Timber Pest</a>
            </li>
          ) : null}
          <li>
            <a href="#records">
              {availableModules.length > 0
                ? "Files & report tools"
                : "Report history"}
            </a>
          </li>
        </ul>
      </nav>

      <div className={styles.reportBody} id="report-content" tabIndex={-1}>
        {snapshot.amendment ? (
          <aside className={styles.notice} aria-labelledby="amendment-heading">
            <h2 id="amendment-heading">Amendment notice</h2>
            <p>{snapshot.amendment.changeNotice}</p>
            <p>
              <strong>Reason:</strong> {snapshot.amendment.reason}
            </p>
          </aside>
        ) : null}

        {buildingGranted && portalState.buildingWithdrawn ? (
          <aside
            className={styles.withdrawal}
            aria-labelledby="building-withdrawal-heading"
          >
            <h2 id="building-withdrawal-heading">Building report withdrawn</h2>
            <p>
              The signing inspector withdrew the Building module on 15 July 2026
              for further professional review. No replacement has been issued.
              Downloaded copies cannot be recalled; this notice and the audit
              history remain available.
            </p>
          </aside>
        ) : null}

        {timberPestGranted && portalState.timberPestWithdrawn ? (
          <aside
            className={styles.withdrawal}
            aria-labelledby="timber-pest-withdrawal-heading"
          >
            <h2 id="timber-pest-withdrawal-heading">
              Timber Pest report withdrawn
            </h2>
            <p>
              The signing inspector withdrew the Timber Pest module on 15 July
              2026 for further professional review. No replacement has been
              issued. Downloaded copies cannot be recalled; this notice and the
              audit history remain available.
            </p>
          </aside>
        ) : null}

        <section
          className={styles.overview}
          id="overview"
          aria-labelledby="overview-heading"
        >
          <p className={styles.eyebrow}>Start here</p>
          <h2 id="overview-heading">Your 30-second summary</h2>
          <p className={styles.overviewLead}>
            {buildingAvailable
              ? overview.majorBuildingSummary
              : timberPestAvailable
                ? "The delivered Timber Pest module and material limitations remain available below."
                : "The delivered report modules have been withdrawn. The notices and report history remain available below."}
          </p>
          <div className={styles.overviewGrid}>
            {buildingAvailable ? (
              <article className={styles.overviewCard}>
                <p className={`${styles.moduleLabel} ${styles.buildingLabel}`}>
                  Building
                </p>
                <h3>
                  {overview.majorBuildingFindings.length}{" "}
                  {overview.majorBuildingFindings.length === 1
                    ? "major finding"
                    : "major findings"}
                </h3>
                <ul className={styles.summaryFindings}>
                  {overview.majorBuildingFindings.map((finding) => (
                    <li key={finding.findingId}>
                      <a href={`#finding-${finding.findingId}`}>
                        {finding.title} — {finding.location}
                      </a>
                    </li>
                  ))}
                </ul>
                <p>{overview.minorBuildingSummary}</p>
              </article>
            ) : null}
            {timberPestAvailable ? (
              <article className={styles.overviewCard}>
                <p className={`${styles.moduleLabel} ${styles.pestLabel}`}>
                  Timber Pest
                </p>
                <h3>Accessible areas inspected</h3>
                <p>{overview.timberPestSummary}</p>
                <a href="#timber-pest">Read the Timber Pest findings</a>
              </article>
            ) : null}
          </div>
          {availableModules.length > 0 ? (
            <div className={styles.limitations}>
              <p className={styles.limitationLabel}>Material limitations</p>
              <h3>What could not be visually assessed</h3>
              <ul>
                {overview.materialLimitations
                  .filter(({ module }) => availableModules.includes(module))
                  .map((limitation) => (
                    <li key={limitation.limitationId}>
                      <strong>{limitation.area}:</strong>{" "}
                      {limitation.description} {limitation.effectOnConclusion}
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </section>

        {buildingAvailable ? (
          <section
            className={styles.moduleSection}
            id="building"
            aria-labelledby="building-heading"
          >
            <p className={`${styles.moduleLabel} ${styles.buildingLabel}`}>
              Building report
            </p>
            <h2 id="building-heading">Building findings</h2>
            <p className={styles.overviewLead}>{building.conclusion}</p>
            <div className={styles.findings}>
              {building.findings.map((finding) => (
                <article
                  className={styles.finding}
                  id={`finding-${finding.findingId}`}
                  key={finding.findingId}
                >
                  <p
                    className={`${styles.moduleLabel} ${styles.buildingLabel}`}
                  >
                    Building report
                  </p>
                  <h3>{finding.title}</h3>
                  <p>{finding.location}</p>
                  <p
                    aria-label={`Inspector-confirmed classification: ${buildingClassificationLabel(finding.classification)}`}
                    className={`${styles.classification} ${
                      finding.classification === "major_defect"
                        ? styles.major
                        : styles.minor
                    }`}
                  >
                    {buildingClassificationLabel(finding.classification)}
                  </p>
                  <dl className={styles.findingSummary}>
                    <div>
                      <dt>What was observed</dt>
                      <dd>{finding.observation}</dd>
                    </div>
                    <div>
                      <dt>Why it matters</dt>
                      <dd>{finding.significance}</dd>
                    </div>
                    <div>
                      <dt>Further inspection</dt>
                      <dd>
                        {finding.furtherInvestigation ??
                          "No further inspection was specified."}
                      </dd>
                    </div>
                  </dl>
                  {finding.curatedMedia.length > 0 ? (
                    <div
                      className={styles.evidenceGrid}
                      aria-label="Inspector-curated evidence"
                    >
                      {finding.curatedMedia.map((media) => (
                        <figure key={media.artifactId}>
                          {/* Dynamic, access-controlled media cannot use static image optimisation. */}
                          <img
                            alt={media.altText}
                            height={180}
                            loading="lazy"
                            src={`/api/media/${media.artifactId}`}
                            width={320}
                          />
                          <figcaption>{media.caption}</figcaption>
                        </figure>
                      ))}
                    </div>
                  ) : null}
                  <details className={styles.findingDetails}>
                    <summary>Inspector assessment and limitations</summary>
                    <dl className={styles.findingGrid}>
                      <div>
                        <dt>Apparent extent</dt>
                        <dd>{finding.apparentExtent}</dd>
                      </div>
                      <div>
                        <dt>Qualified opinion</dt>
                        <dd>{finding.qualifiedOpinion}</dd>
                      </div>
                      <div>
                        <dt>What could not be confirmed</dt>
                        <dd>
                          {finding.uncertainty.length === 0 ? (
                            "No additional uncertainty recorded."
                          ) : (
                            <ul>
                              {finding.uncertainty.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          )}
                        </dd>
                      </div>
                    </dl>
                  </details>
                  <p className={styles.inspectorLine}>
                    <strong>Inspector:</strong> {finding.inspector.displayName},{" "}
                    {finding.inspector.credential}
                  </p>
                </article>
              ))}
            </div>
            <ReportLimitations limitations={building.limitations} />
          </section>
        ) : null}

        {timberPestAvailable ? (
          <section
            className={styles.moduleSection}
            id="timber-pest"
            aria-labelledby="timber-pest-heading"
          >
            <p className={`${styles.moduleLabel} ${styles.pestLabel}`}>
              Timber Pest report
            </p>
            <h2 id="timber-pest-heading">Timber Pest findings</h2>
            <p className={styles.overviewLead}>{timberPest.conclusion}</p>
            <div className={styles.findings}>
              {timberPest.findings.map((finding) => (
                <article className={styles.finding} key={finding.findingId}>
                  <p className={`${styles.moduleLabel} ${styles.pestLabel}`}>
                    Timber Pest report
                  </p>
                  <h3>{finding.title}</h3>
                  <p>{finding.location}</p>
                  <p
                    aria-label={`Inspector-confirmed category: ${timberPestCategoryLabel(finding.category)}`}
                    className={styles.category}
                  >
                    {timberPestCategoryLabel(finding.category)}
                  </p>
                  <dl className={styles.findingSummary}>
                    <div>
                      <dt>What was observed</dt>
                      <dd>{finding.observation}</dd>
                    </div>
                    <div>
                      <dt>Why it matters</dt>
                      <dd>{finding.significance}</dd>
                    </div>
                    <div>
                      <dt>Further inspection</dt>
                      <dd>
                        {finding.furtherInvestigation ??
                          "No further inspection was specified."}
                      </dd>
                    </div>
                  </dl>
                  <details className={styles.findingDetails}>
                    <summary>Inspector assessment and limitations</summary>
                    <dl className={styles.findingGrid}>
                      <div>
                        <dt>Apparent extent</dt>
                        <dd>{finding.apparentExtent}</dd>
                      </div>
                      <div>
                        <dt>Qualified opinion</dt>
                        <dd>{finding.qualifiedOpinion}</dd>
                      </div>
                      <div>
                        <dt>What could not be confirmed</dt>
                        <dd>
                          {finding.uncertainty.length === 0 ? (
                            "No additional uncertainty recorded."
                          ) : (
                            <ul>
                              {finding.uncertainty.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          )}
                        </dd>
                      </div>
                    </dl>
                  </details>
                  <p className={styles.inspectorLine}>
                    <strong>Inspector:</strong> {finding.inspector.displayName},{" "}
                    {finding.inspector.credential}
                  </p>
                </article>
              ))}
            </div>
            <ReportLimitations limitations={timberPest.limitations} />
          </section>
        ) : null}

        <section
          className={styles.records}
          id="records"
          aria-labelledby="records-heading"
        >
          <h2 id="records-heading">
            {availableModules.length > 0 ? "Report files" : "Report history"}
          </h2>
          {availableModules.length > 0 ? (
            <>
              <p>
                HTML is the primary reading experience. These immutable records
                are tied to report version 2.
              </p>
              <ul className={styles.recordList}>
                {buildingAvailable ? (
                  <li>
                    <a href="/reports/demo/download/building">
                      Building report PDF <span>PDF</span>
                    </a>
                  </li>
                ) : null}
                {timberPestAvailable ? (
                  <li>
                    <a href="/reports/demo/download/timber-pest">
                      Timber Pest report PDF <span>PDF</span>
                    </a>
                  </li>
                ) : null}
                <li>
                  <a href="/reports/demo/download/agreement">
                    Signed inspection agreement <span>Record</span>
                  </a>
                </li>
                <li>
                  <a href="/reports/demo/download/invoice">
                    Invoice <span>Record</span>
                  </a>
                </li>
              </ul>
            </>
          ) : (
            <p>
              Downloads are unavailable because all delivered report modules
              have been withdrawn. Version history remains available below.
            </p>
          )}
          <details className={styles.recordDetails}>
            <summary>Version history</summary>
            <table
              className={styles.historyTable}
              aria-label="Report version history"
            >
              <thead>
                <tr>
                  <th scope="col">Version</th>
                  <th scope="col">Issued</th>
                  <th scope="col">Status</th>
                  <th scope="col">Change</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td data-label="Version">2</td>
                  <td data-label="Issued">15 July 2026</td>
                  <td data-label="Status">Current delivered version</td>
                  <td data-label="Change">
                    Clarified the extent of cracked floor tiles
                  </td>
                </tr>
                <tr>
                  <td data-label="Version">1</td>
                  <td data-label="Issued">15 July 2026</td>
                  <td data-label="Status">Superseded, retained</td>
                  <td data-label="Change">Original issued version</td>
                </tr>
              </tbody>
            </table>
            <p className={styles.footerNote}>
              A later amendment is not added to this access automatically. It
              must be explicitly delivered before it can be opened.
            </p>
          </details>
        </section>

        <section
          className={styles.accessSection}
          id="access"
          aria-labelledby="access-heading"
        >
          <h2 id="access-heading">
            {availableModules.length > 0
              ? "Questions and report access"
              : "Report access"}
          </h2>
          <EndReportAccess />
          {availableModules.length > 0 ? (
            <details className={styles.reportTools}>
              <summary>Build Week demo actions</summary>
              <p className={styles.demoBanner}>
                These actions record a demo state only. No question or
                invitation is delivered.
              </p>
              <div className={styles.accessGrid}>
                <ContactInspector
                  availableModules={availableModules}
                  initialRequests={portalState.contactRequests}
                />
                <ShareAccess
                  initialInvitations={portalState.shareInvitations}
                  proposedExpiry={Math.min(
                    Date.now() + 24 * 60 * 60_000,
                    session.expiresAt,
                  )}
                />
              </div>
            </details>
          ) : null}
        </section>

        <p className={styles.footerNote}>
          {availableModules.length === 0
            ? "The delivered report modules have been withdrawn. Only the withdrawal notices and retained report history remain available."
            : `This report records the condition observed during a visual inspection of accessible areas at the inspection time. Its scope is limited to the active professional inspection ${
                buildingAvailable && timberPestAvailable
                  ? "modules above"
                  : "module above"
              }.`}
        </p>
      </div>
    </main>
  );
}

function ReportLimitations({
  limitations,
}: Readonly<{
  limitations: readonly Readonly<{
    limitationId: string;
    area: string;
    description: string;
    effectOnConclusion: string;
  }>[];
}>) {
  return (
    <details className={`${styles.limitations} ${styles.moduleLimitations}`}>
      <summary>View limitations affecting this module</summary>
      <ul>
        {limitations.map((limitation) => (
          <li key={limitation.limitationId}>
            <strong>{limitation.area}:</strong> {limitation.description}{" "}
            {limitation.effectOnConclusion}
          </li>
        ))}
      </ul>
    </details>
  );
}
