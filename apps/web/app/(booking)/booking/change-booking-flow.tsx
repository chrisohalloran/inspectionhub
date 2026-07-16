"use client";

import { useState } from "react";

import { launchSlots } from "./booking-model";
import styles from "./booking.module.css";

export function RescheduleFlow() {
  const [replacementSlot, setReplacementSlot] = useState("slot-1330");
  const [bookingState, setBookingState] = useState<
    "confirmed" | "reschedule-pending" | "rescheduled"
  >("confirmed");
  const [calendarState, setCalendarState] = useState<
    "confirmed" | "pending" | "replaced"
  >("confirmed");

  return (
    <section className={styles.content} aria-labelledby="reschedule-heading">
      <p className={styles.eyebrow}>Test booking SI-1042</p>
      <h1 id="reschedule-heading">Reschedule the inspection</h1>
      <p className={styles.helper}>
        The current appointment remains authoritative until the replacement
        calendar event is observed.
      </p>
      <LiteralStates
        states={[
          ["Booking change", bookingState],
          ["Calendar event", calendarState],
          [
            "Old access link",
            bookingState === "rescheduled" ? "invalidated" : "still current",
          ],
          [
            "Old reminders",
            bookingState === "rescheduled" ? "cancelled" : "still scheduled",
          ],
        ]}
      />
      <div className={styles.bookingReference}>
        <h2>Current appointment</h2>
        <p>Wednesday 15 July, 9:00 am AEST</p>
      </div>
      {bookingState === "confirmed" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setBookingState("reschedule-pending");
            setCalendarState("pending");
          }}
        >
          <fieldset className={styles.cleanFieldset}>
            <legend>Replacement appointment</legend>
            <div className={styles.slotGrid}>
              {launchSlots.slice(1).map((slot) => (
                <label className={styles.slotCard} key={slot.id}>
                  <input
                    checked={replacementSlot === slot.id}
                    name="replacement-appointment"
                    onChange={() => setReplacementSlot(slot.id)}
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
          <div className={styles.actions}>
            <a className={styles.secondaryLink} href="/booking">
              Keep current appointment
            </a>
            <button type="submit">Request test reschedule</button>
          </div>
        </form>
      ) : null}
      {bookingState === "reschedule-pending" ? (
        <div className={styles.errorNotice} role="status">
          <strong>Reschedule pending</strong>
          <p>
            The replacement calendar result is not yet observed. The old slot
            has not been released and repeating the request will not create
            another change.
          </p>
          <button
            onClick={() => {
              setBookingState("rescheduled");
              setCalendarState("replaced");
            }}
            type="button"
          >
            Observe successful test result
          </button>
        </div>
      ) : null}
      {bookingState === "rescheduled" ? (
        <div className={styles.successNotice} role="status">
          <strong>Test inspection rescheduled</strong>
          <p>
            The new test slot is confirmed. The old test slot, access link, and
            reminders are now superseded.
          </p>
          <a href="/booking?scenario=payment-declined">
            Return to booking readiness
          </a>
        </div>
      ) : null}
    </section>
  );
}

export function CancellationFlow() {
  const [confirmed, setConfirmed] = useState(false);
  const [bookingState, setBookingState] = useState<
    "confirmed" | "cancel-pending" | "cancelled"
  >("confirmed");
  const [refundState, setRefundState] = useState<
    "not-requested" | "pending" | "succeeded"
  >("not-requested");
  const [calendarState, setCalendarState] = useState<
    "confirmed" | "cancellation-pending" | "cancelled"
  >("confirmed");

  return (
    <section className={styles.content} aria-labelledby="cancel-heading">
      <p className={styles.eyebrow}>Test booking SI-1042</p>
      <h1 id="cancel-heading">Cancel the inspection</h1>
      <p className={styles.helper}>
        Cancellation, refund, and calendar truth remain separate so an
        incomplete provider action is visible.
      </p>
      <LiteralStates
        states={[
          ["Booking", bookingState],
          ["Refund", refundState],
          ["Calendar", calendarState],
          ["Access link", bookingState === "cancelled" ? "revoked" : "active"],
        ]}
      />
      {bookingState === "confirmed" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!confirmed) return;
            setBookingState("cancel-pending");
            setRefundState("pending");
            setCalendarState("cancellation-pending");
          }}
        >
          <label className={styles.consent}>
            <input
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              type="checkbox"
            />
            <span>
              I understand the appointment will be cancelled after the provider
              results are confirmed.
            </span>
          </label>
          <div className={styles.actions}>
            <a className={styles.secondaryLink} href="/booking">
              Keep this booking
            </a>
            <button disabled={!confirmed} type="submit">
              Request test cancellation
            </button>
          </div>
        </form>
      ) : null}
      {bookingState === "cancel-pending" ? (
        <div className={styles.errorNotice} role="status">
          <strong>Cancellation and refund pending</strong>
          <p>
            The intent is recorded once. Refreshing or repeating this action
            will reconcile the same request instead of creating another refund.
          </p>
          <button
            onClick={() => {
              setBookingState("cancelled");
              setRefundState("succeeded");
              setCalendarState("cancelled");
            }}
            type="button"
          >
            Observe provider results (test)
          </button>
        </div>
      ) : null}
      {bookingState === "cancelled" ? (
        <div className={styles.successNotice} role="status">
          <strong>Test booking cancelled</strong>
          <p>
            The test refund succeeded, the calendar event was cancelled, and the
            access link was revoked.
          </p>
          <a href="/booking">Start another test booking</a>
        </div>
      ) : null}
    </section>
  );
}

function LiteralStates({
  states,
}: {
  states: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <dl className={styles.literalStates} aria-label="Current booking states">
      {states.map(([label, state]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>Test state: {state}</dd>
        </div>
      ))}
    </dl>
  );
}
