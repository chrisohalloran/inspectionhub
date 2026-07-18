"use client";

import { useId, useMemo, useState } from "react";

import {
  formatAud,
  launchQuoteExpiryLabel,
  launchServices,
  launchSlots,
  quoteTotal,
  readinessProjection,
  type BookingScenario,
  type ModuleCode,
  type ReadinessInput,
} from "./booking-model";
import styles from "./booking.module.css";

type Step = 1 | 2 | 3 | 4;

const stepNames = ["Inspection & details", "Time & access", "Review"];

function initialStep(scenario: BookingScenario): Step {
  if (scenario === "payment-declined") return 4;
  if (scenario === "slot-conflict" || scenario === "slot-expired") return 2;
  return 1;
}

function initialReadiness(scenario: BookingScenario): ReadinessInput {
  if (scenario === "payment-declined") {
    return {
      access: "required",
      agreement: "signed",
      calendar: "confirmed",
      payment: "declined",
      slot: "confirmed",
    };
  }

  if (scenario === "slot-conflict" || scenario === "slot-expired") {
    return {
      access: "required",
      agreement: "unsigned",
      calendar: "pending",
      payment: "pending",
      slot: scenario === "slot-expired" ? "expired" : "held",
    };
  }

  return {
    access: "required",
    agreement: "unsigned",
    calendar: "pending",
    payment: "pending",
    slot: "held",
  };
}

export function BookingFlow({ scenario }: { scenario: BookingScenario }) {
  const headingId = useId();
  const [step, setStep] = useState<Step>(() => initialStep(scenario));
  const [selectedModules, setSelectedModules] = useState<Set<ModuleCode>>(
    () => new Set<ModuleCode>(["building", "timber-pest"]),
  );
  const [property, setProperty] = useState(
    "18 Example Street, Southport QLD 4215",
  );
  const [clientName, setClientName] = useState("Alex Morgan");
  const [clientEmail, setClientEmail] = useState("alex@example.test");
  const [clientPhone, setClientPhone] = useState("0400 000 000");
  const [recipientEmail, setRecipientEmail] = useState("alex@example.test");
  const [invoiceEmail, setInvoiceEmail] = useState("alex@example.test");
  const [differentContacts, setDifferentContacts] = useState(false);
  const [accessMode, setAccessMode] = useState<"client" | "contact">("contact");
  const [accessName, setAccessName] = useState("Taylor Lee");
  const [accessPhone, setAccessPhone] = useState("0400 000 001");
  const [selectedSlot, setSelectedSlot] = useState("slot-0900");
  const [agreementAccepted, setAgreementAccepted] = useState(
    scenario === "payment-declined",
  );
  const [readiness, setReadiness] = useState<ReadinessInput>(() =>
    initialReadiness(scenario),
  );
  const [notice, setNotice] = useState<string | null>(null);

  const totalCents = useMemo(
    () => quoteTotal(selectedModules),
    [selectedModules],
  );
  const projection = readinessProjection(readiness);

  function updateModule(code: ModuleCode, selected: boolean) {
    setSelectedModules((current) => {
      const next = new Set(current);
      if (selected) next.add(code);
      else next.delete(code);
      return next;
    });
  }

  function goToStep(next: Step, clearNotice = true) {
    if (clearNotice) setNotice(null);
    setStep(next);
    window.requestAnimationFrame(() => {
      document.getElementById(headingId)?.focus();
    });
  }

  function confirmSlot() {
    setNotice("Appointment confirmed. Your entered details were retained.");
    setReadiness((current) => ({
      ...current,
      access: accessMode === "client" ? "confirmed" : "required",
      calendar: "confirmed",
      slot: "confirmed",
    }));
    if (scenario === "slot-conflict" || scenario === "slot-expired") return;
    goToStep(3, false);
  }

  function signAgreement() {
    setReadiness((current) => ({ ...current, agreement: "signed" }));
    setNotice(
      "Agreement version AG-2026.07-test signed. Your signed record is available.",
    );
    goToStep(4, false);
  }

  function completePayment() {
    setReadiness((current) => ({ ...current, payment: "succeeded" }));
    setNotice("Demo payment confirmed. No card was charged.");
  }

  function confirmAccessForDemo() {
    setReadiness((current) => ({ ...current, access: "confirmed" }));
    setNotice("Property access confirmed by the access contact.");
  }

  const scenarioMessage =
    scenario === "payment-declined" && readiness.payment === "declined"
      ? "The test payment was declined. Property and participant details remain saved; retry only the payment."
      : scenario === "slot-expired" && readiness.slot !== "confirmed"
        ? "The temporary slot hold expired before confirmation. Choose another slot; property and participant details remain saved."
        : scenario === "slot-conflict" && readiness.slot !== "confirmed"
          ? "Another test client confirmed the original slot first. Choose another slot; property and participant details remain saved."
          : null;

  return (
    <section className={styles.bookingShell} aria-labelledby={headingId}>
      <div className={styles.progress}>
        <p className={styles.eyebrow}>Book online</p>
        {step === 4 ? (
          <p>
            Booking status: <strong>{projection.label}</strong>
          </p>
        ) : (
          <p>
            Step {step} of {stepNames.length}:{" "}
            <strong>{stepNames[step - 1]}</strong>
          </p>
        )}
        <ol aria-label="Booking progress">
          {stepNames.map((name, index) => {
            const position = index + 1;
            const state =
              step === 4 || position < step
                ? "Completed"
                : position === step
                  ? "Current"
                  : "Not started";
            return (
              <li
                aria-current={position === step ? "step" : undefined}
                key={name}
              >
                <span>{position}</span>
                {name} <small>{state}</small>
              </li>
            );
          })}
        </ol>
      </div>

      <div className={styles.content}>
        <h1 className={styles.focusHeading} id={headingId} tabIndex={-1}>
          {step === 1 && "Book your inspection"}
          {step === 2 && "Choose a time and access"}
          {step === 3 && "Review and accept"}
          {step === 4 && "Booking status"}
        </h1>

        {scenarioMessage ? (
          <div className={styles.errorNotice} role="alert">
            <strong>Action needed</strong>
            <p>{scenarioMessage}</p>
            <p>
              Retained: {property}; client {clientName}; access contact{" "}
              {accessName}.
            </p>
          </div>
        ) : null}
        {notice ? (
          <p className={styles.successNotice} role="status">
            {notice}
          </p>
        ) : null}

        {step === 1 ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (selectedModules.size > 0) goToStep(2);
            }}
          >
            <fieldset className={styles.cleanFieldset}>
              <legend>Inspection services</legend>
              <p className={styles.helper}>
                Choose one or both. Building and Timber Pest remain separate
                reports.
              </p>
              <div className={styles.serviceGrid}>
                {launchServices.map((service) => (
                  <label
                    className={styles.serviceCard}
                    data-module={service.code}
                    key={service.code}
                  >
                    <input
                      checked={selectedModules.has(service.code)}
                      onChange={(event) =>
                        updateModule(service.code, event.target.checked)
                      }
                      type="checkbox"
                    />
                    <span>
                      <strong>{service.label}</strong>
                      <small>{service.description}</small>
                    </span>
                    <b>{formatAud(service.priceCents)}</b>
                  </label>
                ))}
              </div>
            </fieldset>
            {selectedModules.size === 0 ? (
              <p className={styles.fieldError} role="alert">
                Select at least one inspection module to continue.
              </p>
            ) : null}
            <div className={styles.formSections}>
              <fieldset>
                <legend>Property</legend>
                <label>
                  Property address
                  <input
                    autoComplete="street-address"
                    onChange={(event) => setProperty(event.target.value)}
                    required
                    value={property}
                  />
                </label>
              </fieldset>
              <fieldset>
                <legend>Your details</legend>
                <label>
                  Full name
                  <input
                    autoComplete="name"
                    onChange={(event) => setClientName(event.target.value)}
                    required
                    value={clientName}
                  />
                </label>
                <label>
                  Email
                  <input
                    autoComplete="email"
                    onChange={(event) => {
                      const nextEmail = event.target.value;
                      if (!differentContacts) {
                        setRecipientEmail(nextEmail);
                        setInvoiceEmail(nextEmail);
                      }
                      setClientEmail(nextEmail);
                    }}
                    required
                    type="email"
                    value={clientEmail}
                  />
                </label>
                <label>
                  Mobile number
                  <input
                    autoComplete="tel"
                    onChange={(event) => setClientPhone(event.target.value)}
                    required
                    type="tel"
                    value={clientPhone}
                  />
                </label>
              </fieldset>
            </div>
            <details className={styles.optionalDetails}>
              <summary>Use different report or invoice contacts</summary>
              <div className={styles.optionalFields}>
                <label>
                  Report recipient email
                  <input
                    onChange={(event) => {
                      setDifferentContacts(true);
                      setRecipientEmail(event.target.value);
                    }}
                    type="email"
                    value={recipientEmail}
                  />
                </label>
                <label>
                  Invoice contact email
                  <input
                    onChange={(event) => {
                      setDifferentContacts(true);
                      setInvoiceEmail(event.target.value);
                    }}
                    type="email"
                    value={invoiceEmail}
                  />
                </label>
              </div>
            </details>
            <QuoteSummary
              selectedModules={selectedModules}
              totalCents={totalCents}
            />
            <div className={styles.actions}>
              <button disabled={selectedModules.size === 0} type="submit">
                Continue
              </button>
            </div>
          </form>
        ) : null}

        {step === 2 ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              confirmSlot();
            }}
          >
            <p className={styles.helper}>
              Times use Australia/Brisbane (AEST). Travel time is already
              allowed for.
            </p>
            <fieldset className={styles.cleanFieldset}>
              <legend>Available times</legend>
              <div className={styles.slotGrid}>
                {launchSlots.map((slot) => (
                  <label className={styles.slotCard} key={slot.id}>
                    <input
                      checked={selectedSlot === slot.id}
                      name="appointment"
                      onChange={() => setSelectedSlot(slot.id)}
                      type="radio"
                      value={slot.id}
                    />
                    <span>
                      <strong>{slot.label}</strong>
                      <small>{slot.note}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className={styles.cleanFieldset}>
              <legend>Who can provide access?</legend>
              <div className={styles.slotGrid}>
                <label className={styles.slotCard}>
                  <input
                    checked={accessMode === "client"}
                    name="access-mode"
                    onChange={() => setAccessMode("client")}
                    type="radio"
                  />
                  <span>
                    <strong>I can provide access</strong>
                    <small>
                      Use {clientName} · {clientPhone}
                    </small>
                  </span>
                </label>
                <label className={styles.slotCard}>
                  <input
                    checked={accessMode === "contact"}
                    name="access-mode"
                    onChange={() => setAccessMode("contact")}
                    type="radio"
                  />
                  <span>
                    <strong>Contact the agent or owner</strong>
                    <small>They receive access messages only.</small>
                  </span>
                </label>
              </div>
            </fieldset>
            {accessMode === "contact" ? (
              <div className={styles.formSections}>
                <fieldset>
                  <legend>Access contact</legend>
                  <label>
                    Full name
                    <input
                      onChange={(event) => setAccessName(event.target.value)}
                      required
                      value={accessName}
                    />
                  </label>
                  <label>
                    Mobile number
                    <input
                      autoComplete="tel"
                      onChange={(event) => setAccessPhone(event.target.value)}
                      required
                      type="tel"
                      value={accessPhone}
                    />
                  </label>
                </fieldset>
              </div>
            ) : null}
            <div className={styles.actions}>
              <button
                className={styles.secondaryButton}
                onClick={() => goToStep(1)}
                type="button"
              >
                Back
              </button>
              <button type="submit">
                {scenario === "standard"
                  ? "Continue to review"
                  : "Confirm replacement time"}
              </button>
            </div>
            {scenario !== "standard" && readiness.slot === "confirmed" ? (
              <div className={styles.recoveryNext}>
                <p>Replacement time confirmed. Your details were retained.</p>
                <button onClick={() => goToStep(3)} type="button">
                  Continue to review
                </button>
              </div>
            ) : null}
          </form>
        ) : null}

        {step === 3 ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (agreementAccepted) signAgreement();
            }}
          >
            <section
              className={styles.reviewSummary}
              aria-labelledby="review-summary"
            >
              <h2 id="review-summary">Your booking</h2>
              <dl>
                <div>
                  <dt>Property</dt>
                  <dd>{property}</dd>
                </div>
                <div>
                  <dt>Inspection</dt>
                  <dd>
                    {launchServices
                      .filter((service) => selectedModules.has(service.code))
                      .map((service) => service.label)
                      .join(" and ")}
                  </dd>
                </div>
                <div>
                  <dt>Appointment</dt>
                  <dd>
                    {
                      launchSlots.find((slot) => slot.id === selectedSlot)
                        ?.label
                    }
                  </dd>
                </div>
                <div>
                  <dt>Property access</dt>
                  <dd>
                    {accessMode === "client"
                      ? `${clientName} will provide access`
                      : `Confirmation required from ${accessName}`}
                  </dd>
                </div>
                <div>
                  <dt>Total including GST</dt>
                  <dd>{formatAud(totalCents)}</dd>
                </div>
              </dl>
            </section>
            <div className={styles.agreement}>
              <p className={styles.versionLabel}>
                Agreement version AG-2026.07-test
              </p>
              {selectedModules.has("building") ? (
                <section aria-labelledby="building-scope">
                  <p className={styles.moduleLabel} data-module="building">
                    Building module
                  </p>
                  <h2 id="building-scope">
                    Visual pre-purchase Building inspection
                  </h2>
                  <p>
                    The Building report records the condition apparent in
                    accessible areas at the inspection time, including
                    inspector-classified major and minor defects and material
                    limitations.
                  </p>
                </section>
              ) : null}
              {selectedModules.has("timber-pest") ? (
                <section aria-labelledby="pest-scope">
                  <p className={styles.moduleLabel} data-module="timber-pest">
                    Timber Pest module
                  </p>
                  <h2 id="pest-scope">Visual Timber Pest inspection</h2>
                  <p>
                    The Timber Pest report remains separate, uses its own
                    categories, and records accessible-area observations and
                    material limitations. This journey makes no guarantee about
                    concealed conditions.
                  </p>
                </section>
              ) : null}
              <section aria-labelledby="limits-heading">
                <h2 id="limits-heading">Material scope limits</h2>
                <p>
                  This is a visual inspection of accessible areas. The inspector
                  does not provide purchase, negotiation, valuation, or
                  repair-cost advice.
                </p>
              </section>
            </div>
            <label className={styles.consent}>
              <input
                checked={agreementAccepted}
                onChange={(event) => setAgreementAccepted(event.target.checked)}
                type="checkbox"
              />
              <span>
                I am {clientName} and I accept this inspection agreement.
              </span>
            </label>
            <div className={styles.actions}>
              <button
                className={styles.secondaryButton}
                onClick={() => goToStep(2)}
                type="button"
              >
                Back
              </button>
              <button disabled={!agreementAccepted} type="submit">
                Accept agreement and continue
              </button>
            </div>
          </form>
        ) : null}

        {step === 4 ? (
          <div>
            <div className={styles.bookingReference}>
              <p className={styles.eyebrow}>Booking SI-1042</p>
              <h2>{property}</h2>
              <p>
                Client: {clientName} · Report recipient: {recipientEmail}
              </p>
            </div>
            <section
              aria-labelledby="readiness-heading"
              className={styles.readiness}
            >
              <div>
                <p className={styles.eyebrow}>Booking status</p>
                <h2 id="readiness-heading">{projection.label}</h2>
                {projection.outstanding.length > 0 ? (
                  <p>
                    {projection.outstanding.length} required{" "}
                    {projection.outstanding.length === 1
                      ? "action remains"
                      : "actions remain"}
                    .
                  </p>
                ) : (
                  <p>Everything required has been confirmed.</p>
                )}
              </div>
              <ReadinessRow
                label="Appointment and calendar"
                state={
                  readiness.slot === "confirmed" &&
                  readiness.calendar === "confirmed"
                    ? "Confirmed"
                    : "Pending"
                }
              />
              <ReadinessRow
                label="Signed agreement"
                state={readiness.agreement === "signed" ? "Signed" : "Required"}
              />
              <ReadinessRow
                label="Payment"
                state={
                  readiness.payment === "succeeded"
                    ? "Confirmed"
                    : readiness.payment === "declined"
                      ? "Declined — retry available"
                      : "Required"
                }
              />
              <ReadinessRow
                label="Property access"
                state={
                  readiness.access === "confirmed"
                    ? "Confirmed"
                    : readiness.access === "requested"
                      ? "Confirmation requested"
                      : "Required"
                }
              />
            </section>
            <div className={styles.actionCards}>
              {readiness.payment !== "succeeded" ? (
                <section aria-labelledby="payment-action">
                  <h3 id="payment-action">
                    {readiness.payment === "declined"
                      ? "Retry payment"
                      : "Complete payment"}
                  </h3>
                  <p>
                    No card details are collected and no real charge is made in
                    this seeded journey.
                  </p>
                  <button onClick={completePayment} type="button">
                    {readiness.payment === "declined"
                      ? "Retry payment"
                      : "Complete payment"}
                  </button>
                </section>
              ) : null}
              {readiness.access !== "confirmed" ? (
                <section aria-labelledby="access-action">
                  <h3 id="access-action">Confirm property access</h3>
                  <p>
                    {accessName} ({accessPhone}) receives an access-only
                    confirmation request.
                  </p>
                  {readiness.access === "requested" ? (
                    <>
                      <p className={styles.waitingMessage} role="status">
                        Waiting for {accessName} to confirm. You do not need to
                        do anything.
                      </p>
                      <details className={styles.demoControl}>
                        <summary>Demo control</summary>
                        <button onClick={confirmAccessForDemo} type="button">
                          Simulate contact confirmation
                        </button>
                      </details>
                    </>
                  ) : (
                    <button
                      onClick={() => {
                        setReadiness((current) => ({
                          ...current,
                          access: "requested",
                        }));
                        setNotice(
                          "Access-only confirmation sent. No report data was included.",
                        );
                      }}
                      type="button"
                    >
                      Send access request
                    </button>
                  )}
                </section>
              ) : null}
              {readiness.agreement !== "signed" ? (
                <section aria-labelledby="agreement-action">
                  <h3 id="agreement-action">Sign the agreement</h3>
                  <p>
                    The exact agreement version must be signed before this
                    booking can be ready.
                  </p>
                  <button onClick={() => goToStep(3)} type="button">
                    Review agreement
                  </button>
                </section>
              ) : null}
            </div>
            <div className={styles.changeLinks}>
              <a href="/booking/reschedule">Reschedule booking</a>
              <a href="/booking/cancel">Cancel booking</a>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function QuoteSummary({
  selectedModules,
  totalCents,
}: {
  selectedModules: ReadonlySet<ModuleCode>;
  totalCents: number;
}) {
  return (
    <section className={styles.quote} aria-labelledby="quote-heading">
      <div>
        <p className={styles.eyebrow}>Transparent quote</p>
        <h2 id="quote-heading">Inspection fee</h2>
      </div>
      <dl>
        {launchServices
          .filter((service) => selectedModules.has(service.code))
          .map((service) => (
            <div key={service.code}>
              <dt>{service.label}</dt>
              <dd>{formatAud(service.priceCents)}</dd>
            </div>
          ))}
        <div className={styles.totalRow}>
          <dt>Total including GST</dt>
          <dd>{formatAud(totalCents)}</dd>
        </div>
      </dl>
      <p className={styles.quoteExpiry}>
        Quote Q-1042-test · version PRICE-2026.07 · expires{" "}
        {launchQuoteExpiryLabel}
      </p>
    </section>
  );
}

function ReadinessRow({ label, state }: { label: string; state: string }) {
  return (
    <div className={styles.readinessRow}>
      <span>{label}</span>
      <strong>{state}</strong>
    </div>
  );
}
