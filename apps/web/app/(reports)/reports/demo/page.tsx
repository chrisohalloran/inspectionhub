import {
  buildConditionOverview,
  buildingClassificationLabel,
  createSyntheticRecipientReport,
  timberPestCategoryLabel,
} from "@inspection/reporting/web";
import { redirect } from "next/navigation";

import { demoPortalState, readPortalSession } from "../_lib/recipient-session";
import { ContactInspector } from "./contact-inspector";
import styles from "./report.module.css";
import { ShareAccess } from "./share-access";

const dateFormatter = new Intl.DateTimeFormat("en-AU", {
  dateStyle: "long",
  timeZone: "Australia/Brisbane",
});

export default async function DemoReportPage() {
  const session = await readPortalSession();
  let portalState: Awaited<ReturnType<typeof demoPortalState>>;
  try {
    if (session === null) throw new Error("recipient_session_missing");
    portalState = await demoPortalState(session);
  } catch {
    redirect("/auth/invitation");
  }

  const snapshot = createSyntheticRecipientReport();
  const overview = buildConditionOverview(snapshot);
  const withdrawn = portalState.buildingWithdrawn;
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
            <a href="#overview">Condition overview</a>
          </li>
          <li>
            <a href="#building">Building</a>
          </li>
          <li>
            <a href="#timber-pest">Timber Pest</a>
          </li>
          <li>
            <a href="#records">Records</a>
          </li>
          <li>
            <a href="#access">Access</a>
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

        {withdrawn ? (
          <aside
            className={styles.withdrawal}
            aria-labelledby="withdrawal-heading"
          >
            <h2 id="withdrawal-heading">Building report withdrawn</h2>
            <p>
              The signing inspector withdrew the Building module on 15 July 2026
              for further professional review. No replacement has been issued.
              Downloaded copies cannot be recalled; this notice and the audit
              history remain available.
            </p>
          </aside>
        ) : null}

        <section
          className={styles.overview}
          id="overview"
          aria-labelledby="overview-heading"
        >
          <p className={styles.eyebrow}>Start here</p>
          <h2 id="overview-heading">Condition overview</h2>
          <p className={styles.overviewLead}>
            {withdrawn
              ? "The Building module has been withdrawn. The delivered Timber Pest module and material limitations remain available below."
              : overview.majorBuildingSummary}
          </p>
          <div className={styles.overviewGrid}>
            {!withdrawn ? (
              <article className={styles.overviewCard}>
                <p className={`${styles.moduleLabel} ${styles.buildingLabel}`}>
                  Building report
                </p>
                <h3>{overview.majorBuildingFindings[0]?.title}</h3>
                <p>{overview.majorBuildingFindings[0]?.location}</p>
                <p>{overview.minorBuildingSummary}</p>
                <a href="#finding-finding_cracked_tiles">
                  Read the major Building finding
                </a>
              </article>
            ) : null}
            <article className={styles.overviewCard}>
              <p className={`${styles.moduleLabel} ${styles.pestLabel}`}>
                Timber Pest report
              </p>
              <h3>Accessible areas and conducive conditions</h3>
              <p>{overview.timberPestSummary}</p>
              <a href="#timber-pest">Read the Timber Pest findings</a>
            </article>
          </div>
          <div className={styles.limitations}>
            <p className={styles.limitationLabel}>Material limitations</p>
            <h3>What could not be visually assessed</h3>
            <ul>
              {overview.materialLimitations.map((limitation) => (
                <li key={limitation.limitationId}>
                  <strong>{limitation.area}:</strong> {limitation.description}{" "}
                  {limitation.effectOnConclusion}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {!withdrawn ? (
          <section
            className={styles.moduleSection}
            id="building"
            aria-labelledby="building-heading"
          >
            <p className={`${styles.moduleLabel} ${styles.buildingLabel}`}>
              Building report
            </p>
            <h2 id="building-heading">Building condition</h2>
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
                    className={`${styles.classification} ${
                      finding.classification === "major_defect"
                        ? styles.major
                        : styles.minor
                    }`}
                  >
                    Inspector-confirmed classification:{" "}
                    {buildingClassificationLabel(finding.classification)}
                  </p>
                  <dl className={styles.findingGrid}>
                    <div>
                      <dt>Observation</dt>
                      <dd>{finding.observation}</dd>
                    </div>
                    <div>
                      <dt>Apparent extent</dt>
                      <dd>{finding.apparentExtent}</dd>
                    </div>
                    <div>
                      <dt>Significance</dt>
                      <dd>{finding.significance}</dd>
                    </div>
                    <div>
                      <dt>Qualified opinion</dt>
                      <dd>{finding.qualifiedOpinion}</dd>
                    </div>
                    <div>
                      <dt>Uncertainty</dt>
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
                    <div>
                      <dt>Further investigation</dt>
                      <dd>
                        {finding.furtherInvestigation ?? "Not specified."}
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
                  <p>
                    <strong>Inspector:</strong> {finding.inspector.displayName},{" "}
                    {finding.inspector.credential}
                  </p>
                </article>
              ))}
            </div>
            <ReportLimitations limitations={building.limitations} />
          </section>
        ) : (
          <section className={styles.moduleSection} id="building">
            <p className={`${styles.moduleLabel} ${styles.buildingLabel}`}>
              Building report
            </p>
            <h2>Building content unavailable</h2>
            <p>
              This module was withdrawn. See the withdrawal notice and report
              history for the professional status of the earlier record.
            </p>
          </section>
        )}

        <section
          className={styles.moduleSection}
          id="timber-pest"
          aria-labelledby="timber-pest-heading"
        >
          <p className={`${styles.moduleLabel} ${styles.pestLabel}`}>
            Timber Pest report
          </p>
          <h2 id="timber-pest-heading">Timber Pest condition</h2>
          <p className={styles.overviewLead}>{timberPest.conclusion}</p>
          <div className={styles.findings}>
            {timberPest.findings.map((finding) => (
              <article className={styles.finding} key={finding.findingId}>
                <p className={`${styles.moduleLabel} ${styles.pestLabel}`}>
                  Timber Pest report
                </p>
                <h3>{finding.title}</h3>
                <p>{finding.location}</p>
                <p className={styles.category}>
                  Inspector-confirmed category:{" "}
                  {timberPestCategoryLabel(finding.category)}
                </p>
                <dl className={styles.findingGrid}>
                  <div>
                    <dt>Observation</dt>
                    <dd>{finding.observation}</dd>
                  </div>
                  <div>
                    <dt>Apparent extent</dt>
                    <dd>{finding.apparentExtent}</dd>
                  </div>
                  <div>
                    <dt>Significance</dt>
                    <dd>{finding.significance}</dd>
                  </div>
                  <div>
                    <dt>Qualified opinion</dt>
                    <dd>{finding.qualifiedOpinion}</dd>
                  </div>
                  <div>
                    <dt>Uncertainty</dt>
                    <dd>
                      <ul>
                        {finding.uncertainty.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                  <div>
                    <dt>Further investigation</dt>
                    <dd>{finding.furtherInvestigation ?? "Not specified."}</dd>
                  </div>
                </dl>
                <p>
                  <strong>Inspector:</strong> {finding.inspector.displayName},{" "}
                  {finding.inspector.credential}
                </p>
              </article>
            ))}
          </div>
          <ReportLimitations limitations={timberPest.limitations} />
        </section>

        <section
          className={styles.records}
          id="records"
          aria-labelledby="records-heading"
        >
          <h2 id="records-heading">Report records</h2>
          <p>
            HTML is the primary reading experience. These immutable records are
            tied to report version 2.
          </p>
          <ul className={styles.recordList}>
            {!withdrawn ? (
              <li>
                <a href="/reports/demo/download/building">
                  Building report PDF <span>PDF</span>
                </a>
              </li>
            ) : null}
            <li>
              <a href="/reports/demo/download/timber-pest">
                Timber Pest report PDF <span>PDF</span>
              </a>
            </li>
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
          <h3>Version history</h3>
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
            A later amendment is not added to this access automatically. It must
            be explicitly delivered before it can be opened.
          </p>
        </section>

        <section
          className={styles.accessSection}
          id="access"
          aria-labelledby="access-heading"
        >
          <h2 id="access-heading">Access and questions</h2>
          <div className={styles.accessGrid}>
            <ShareAccess
              initialInvitations={portalState.shareInvitations}
              proposedExpiry={Math.min(
                Date.now() + 24 * 60 * 60_000,
                session.expiresAt,
              )}
            />
            <ContactInspector initialRequests={portalState.contactRequests} />
          </div>
        </section>

        <p className={styles.footerNote}>
          This report records the condition observed during a visual inspection
          of accessible areas at the inspection time. Its scope is limited to
          the professional Building and Timber Pest inspection modules above.
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
    <div className={styles.limitations}>
      <p className={styles.limitationLabel}>Inspection limitations</p>
      <h3>Limits affecting this module</h3>
      <ul>
        {limitations.map((limitation) => (
          <li key={limitation.limitationId}>
            <strong>{limitation.area}:</strong> {limitation.description}{" "}
            {limitation.effectOnConclusion}
          </li>
        ))}
      </ul>
    </div>
  );
}
