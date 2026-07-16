"use client";

import { useEffect, useMemo, useState } from "react";

import {
  createNextPriceVersion,
  credentialAuthority,
  integrationDisplay,
  seededExistingQuote,
  seededPriceVersions,
  type PriceVersion,
} from "./admin-model";
import styles from "./admin.module.css";

export function AdminConfiguration({
  permissionDenied,
}: {
  permissionDenied: boolean;
}) {
  const current = seededPriceVersions[0];
  if (!current)
    throw new Error("The seeded price history must include a current version.");
  const [buildingPrice, setBuildingPrice] = useState(
    current.buildingCents / 100,
  );
  const [timberPestPrice, setTimberPestPrice] = useState(
    current.timberPestCents / 100,
  );
  const [effectiveDate, setEffectiveDate] = useState("2026-08-01");
  const [priceReview, setPriceReview] = useState(false);
  const [publishedVersion, setPublishedVersion] = useState<PriceVersion | null>(
    null,
  );
  const [availabilitySaved, setAvailabilitySaved] = useState(false);
  const [bufferMinutes, setBufferMinutes] = useState(45);
  const [eligibilityReview, setEligibilityReview] = useState(false);
  const [credentialStatus, setCredentialStatus] = useState<
    "active" | "revoked"
  >("active");
  const [buildingEligible, setBuildingEligible] = useState(true);
  const [timberPestEligible, setTimberPestEligible] = useState(true);
  const [expiryDate, setExpiryDate] = useState("2027-06-30");
  const [integrationResult, setIntegrationResult] = useState<string | null>(
    null,
  );

  const unsavedPricing =
    buildingPrice !== current.buildingCents / 100 ||
    timberPestPrice !== current.timberPestCents / 100 ||
    effectiveDate !== "2026-08-01";
  const authority = useMemo(
    () =>
      credentialAuthority({
        asAt: "2026-07-14",
        buildingEligible: buildingEligible && credentialStatus === "active",
        expiryDate,
        timberPestEligible: timberPestEligible && credentialStatus === "active",
      }),
    [buildingEligible, credentialStatus, expiryDate, timberPestEligible],
  );

  useEffect(() => {
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      if (!unsavedPricing || publishedVersion) return;
      event.preventDefault();
    }
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [publishedVersion, unsavedPricing]);

  return (
    <section aria-labelledby="configuration-heading">
      <div className={styles.titleBlock}>
        <p className={styles.eyebrow}>Launch administration</p>
        <h1 id="configuration-heading">Configuration</h1>
        <p>
          Seeded controls and version history for the Build Week test
          environment.
        </p>
      </div>

      {permissionDenied ? (
        <div className={styles.errorNotice} role="alert">
          <strong>Permission denied</strong>
          <p>
            This test actor can read configuration history but cannot publish or
            operate provider controls.
          </p>
        </div>
      ) : null}

      <fieldset
        className={styles.permissionBoundary}
        disabled={permissionDenied}
      >
        <legend className={styles.srOnly}>Editable launch configuration</legend>

        <article className={styles.panel} id="services">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>PRICE-2026.07 · published</p>
              <h2>Services and pricing</h2>
            </div>
            <span className={styles.stateLabel}>Current version</span>
          </div>
          <p className={styles.helper}>
            Publishing creates a new effective-dated version. Existing quote{" "}
            {seededExistingQuote.quoteId} remains on{" "}
            {seededExistingQuote.version}.
          </p>
          <div className={styles.formGrid}>
            <label>
              Building inspection (AUD including GST)
              <input
                min="1"
                onChange={(event) =>
                  setBuildingPrice(event.target.valueAsNumber)
                }
                type="number"
                value={buildingPrice}
              />
            </label>
            <label>
              Timber Pest inspection (AUD including GST)
              <input
                min="1"
                onChange={(event) =>
                  setTimberPestPrice(event.target.valueAsNumber)
                }
                type="number"
                value={timberPestPrice}
              />
            </label>
            <label>
              Effective date
              <input
                onChange={(event) => setEffectiveDate(event.target.value)}
                type="date"
                value={effectiveDate}
              />
            </label>
          </div>
          {unsavedPricing && !publishedVersion ? (
            <p className={styles.unsaved} role="status">
              Unsaved pricing draft. Leaving this page will warn you.
            </p>
          ) : null}
          {priceReview && !publishedVersion ? (
            <div className={styles.reviewBox} role="status">
              <strong>Publish confirmation</strong>
              <p>
                New quotes from {effectiveDate} will use Building $
                {buildingPrice.toFixed(2)} and Timber Pest $
                {timberPestPrice.toFixed(2)}. Existing quotes will not change.
              </p>
              <div className={styles.actions}>
                <button
                  className={styles.secondaryButton}
                  onClick={() => setPriceReview(false)}
                  type="button"
                >
                  Keep editing
                </button>
                <button
                  onClick={() => {
                    setPublishedVersion(
                      createNextPriceVersion({
                        buildingCents: Math.round(buildingPrice * 100),
                        effectiveDate,
                        timberPestCents: Math.round(timberPestPrice * 100),
                      }),
                    );
                    setPriceReview(false);
                  }}
                  type="button"
                >
                  Confirm version publish
                </button>
              </div>
            </div>
          ) : null}
          {publishedVersion ? (
            <p className={styles.successNotice} role="status">
              {publishedVersion.version} published for{" "}
              {publishedVersion.effectiveDate}. Existing quote{" "}
              {seededExistingQuote.quoteId} remains unchanged.
            </p>
          ) : null}
          <div className={styles.actions}>
            <button
              disabled={!unsavedPricing || priceReview}
              onClick={() => setPriceReview(true)}
              type="button"
            >
              Review new price version
            </button>
          </div>
          <details className={styles.history}>
            <summary>Read prior price versions</summary>
            <table>
              <caption>Published price history</caption>
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Effective</th>
                  <th>Building</th>
                  <th>Timber Pest</th>
                </tr>
              </thead>
              <tbody>
                {seededPriceVersions.map((version) => (
                  <tr key={version.version}>
                    <th scope="row">{version.version}</th>
                    <td data-label="Effective">{version.effectiveDate}</td>
                    <td data-label="Building">
                      ${(version.buildingCents / 100).toFixed(2)}
                    </td>
                    <td data-label="Timber Pest">
                      ${(version.timberPestCents / 100).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </article>

        <article className={styles.panel} id="availability">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>Australia/Brisbane</p>
              <h2>Availability</h2>
            </div>
            <span className={styles.attentionLabel}>
              Calendar stale · 18 minutes
            </span>
          </div>
          <div className={styles.formGrid}>
            <label>
              Weekday start
              <input defaultValue="08:00" type="time" />
            </label>
            <label>
              Weekday finish
              <input defaultValue="16:30" type="time" />
            </label>
            <label>
              Travel buffer (minutes)
              <input
                min="0"
                onChange={(event) =>
                  setBufferMinutes(event.target.valueAsNumber)
                }
                type="number"
                value={bufferMinutes}
              />
            </label>
            <label>
              Blackout date
              <input defaultValue="2026-07-20" type="date" />
            </label>
          </div>
          <div className={styles.preview}>
            <h3>Conflict preview</h3>
            <ul>
              <li>
                15 July, 9:00 am — blocked by existing booking and{" "}
                {bufferMinutes}-minute travel buffer
              </li>
              <li>20 July — removed by blackout date</li>
            </ul>
          </div>
          {availabilitySaved ? (
            <p className={styles.successNotice} role="status">
              Availability version AVAIL-2026.07-test saved. Audit event
              recorded.
            </p>
          ) : null}
          <div className={styles.actions}>
            <button
              className={styles.secondaryButton}
              onClick={() => setAvailabilitySaved(false)}
              type="button"
            >
              Retry calendar preview
            </button>
            <button onClick={() => setAvailabilitySaved(true)} type="button">
              Save availability version
            </button>
          </div>
        </article>

        <article className={styles.panel} id="eligibility">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>Inspector INS-001</p>
              <h2>Inspector eligibility</h2>
            </div>
            <span
              className={
                credentialStatus === "active"
                  ? styles.stateLabel
                  : styles.attentionLabel
              }
            >
              {credentialStatus}
            </span>
          </div>
          <div className={styles.formGrid}>
            <label>
              Inspector name
              <input defaultValue="Chris O'Halloran" />
            </label>
            <label>
              Queensland licence / credential reference
              <input defaultValue="QBCC-TEST-001" />
            </label>
            <label>
              Credential expiry
              <input
                onChange={(event) => setExpiryDate(event.target.value)}
                type="date"
                value={expiryDate}
              />
            </label>
            <label>
              Evidence attachment
              <input aria-describedby="evidence-help" type="file" />
            </label>
          </div>
          <p className={styles.helper} id="evidence-help">
            Test files remain private and are represented here by metadata only.
          </p>
          <div className={styles.checkboxGrid}>
            <label>
              <input
                checked={buildingEligible}
                onChange={(event) => setBuildingEligible(event.target.checked)}
                type="checkbox"
              />
              Building module eligibility
            </label>
            <label>
              <input
                checked={timberPestEligible}
                onChange={(event) =>
                  setTimberPestEligible(event.target.checked)
                }
                type="checkbox"
              />
              Timber Pest module eligibility
            </label>
          </div>
          <dl className={styles.authorityPreview}>
            <div>
              <dt>Building approval authority</dt>
              <dd>{authority.building}</dd>
            </div>
            <div>
              <dt>Timber Pest approval authority</dt>
              <dd>{authority.timberPest}</dd>
            </div>
          </dl>
          {eligibilityReview ? (
            <div className={styles.reviewBox} role="status">
              <strong>Authority-change preview</strong>
              <p>
                Revocation prevents later approvals for both modules. Existing
                immutable approvals remain attributed and auditable.
              </p>
              <div className={styles.actions}>
                <button
                  className={styles.secondaryButton}
                  onClick={() => setEligibilityReview(false)}
                  type="button"
                >
                  Keep active
                </button>
                <button
                  onClick={() => {
                    setCredentialStatus("revoked");
                    setEligibilityReview(false);
                  }}
                  type="button"
                >
                  Confirm credential revocation
                </button>
              </div>
            </div>
          ) : null}
          <div className={styles.actions}>
            <button
              className={styles.secondaryButton}
              onClick={() => setEligibilityReview(true)}
              type="button"
            >
              Preview credential revocation
            </button>
            <button type="button">Publish eligibility version</button>
          </div>
          <details className={styles.history}>
            <summary>Read audited credential history</summary>
            <p>
              14 July 2026, 8:45 am — credential CRED-2026.07 published by Test
              Administrator.
            </p>
          </details>
        </article>

        <article className={styles.panel} id="integrations">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>
                Test environment · no live credentials
              </p>
              <h2>Integrations</h2>
            </div>
          </div>
          <div className={styles.integrationList}>
            <IntegrationCard
              name="Stripe test adapter"
              state="connected"
              observed="14 July, 11:42 am"
              scope="Test payment intents only"
            />
            <IntegrationCard
              name="Google Calendar fake"
              state="attention"
              observed="14 July, 11:24 am"
              scope="Availability and event test fixtures"
            />
            <IntegrationCard
              name="Resend fake"
              state="disabled"
              observed="Never"
              scope="No external delivery"
            />
          </div>
          <p className={styles.helper}>
            Secret values are never displayed. Rotation posture: test keys
            configured; live keys absent.
          </p>
          {integrationResult ? (
            <p className={styles.successNotice} role="status">
              {integrationResult}
            </p>
          ) : null}
          <div className={styles.actions}>
            <button
              onClick={() =>
                setIntegrationResult(
                  "Integration test completed with a redacted result. No secret value was returned.",
                )
              }
              type="button"
            >
              Run safe integration test
            </button>
          </div>
        </article>
      </fieldset>
    </section>
  );
}

function IntegrationCard({
  name,
  observed,
  scope,
  state,
}: {
  name: string;
  observed: string;
  scope: string;
  state: "attention" | "connected" | "disabled";
}) {
  return (
    <section>
      <div>
        <h3>{name}</h3>
        <span
          className={
            state === "connected" ? styles.stateLabel : styles.attentionLabel
          }
        >
          {state}
        </span>
      </div>
      <p>{integrationDisplay({ lastObserved: observed, state })}</p>
      <p>Configured scope: {scope}</p>
    </section>
  );
}
