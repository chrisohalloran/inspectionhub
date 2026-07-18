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
      <p className={styles.eyebrow}>Booking SI-1042</p>
      <h1 id="reschedule-heading">Reschedule the inspection</h1>
      <p className={styles.helper}>
        Your current time stays confirmed until the new time is accepted.
      </p>
      <div className={styles.bookingReference}>
        <h2>Current appointment</h2>
        <p>Monday 20 July, 9:00 am AEST</p>
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
            <button type="submit">Confirm new time</button>
          </div>
        </form>
      ) : null}
      {bookingState === "reschedule-pending" ? (
        <div className={styles.errorNotice} role="status">
          <strong>Reschedule pending</strong>
          <p>
            We are confirming the new time. Your existing appointment remains
            booked until this finishes.
          </p>
          <details className={styles.demoControl}>
            <summary>Demo control</summary>
            <button
              onClick={() => {
                setBookingState("rescheduled");
                setCalendarState("replaced");
              }}
              type="button"
            >
              Complete demo update
            </button>
          </details>
        </div>
      ) : null}
      {bookingState === "rescheduled" ? (
        <div className={styles.successNotice} role="status">
          <strong>Inspection rescheduled</strong>
          <p>
            The new time is confirmed. The earlier appointment and reminders
            have been replaced.
          </p>
          <a href="/booking?scenario=payment-declined">
            Return to booking status
          </a>
        </div>
      ) : null}
      <TechnicalBookingStates
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
      <p className={styles.eyebrow}>Booking SI-1042</p>
      <h1 id="cancel-heading">Cancel the inspection</h1>
      <p className={styles.helper}>
        Cancelling updates the appointment, access link and any applicable
        refund.
      </p>
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
              Cancel inspection
            </button>
          </div>
        </form>
      ) : null}
      {bookingState === "cancel-pending" ? (
        <div className={styles.errorNotice} role="status">
          <strong>Cancellation and refund pending</strong>
          <p>
            We recorded your request. The appointment and any applicable refund
            are being updated.
          </p>
          <details className={styles.demoControl}>
            <summary>Demo control</summary>
            <button
              onClick={() => {
                setBookingState("cancelled");
                setRefundState("succeeded");
                setCalendarState("cancelled");
              }}
              type="button"
            >
              Complete demo cancellation
            </button>
          </details>
        </div>
      ) : null}
      {bookingState === "cancelled" ? (
        <div className={styles.successNotice} role="status">
          <strong>Booking cancelled</strong>
          <p>
            The appointment is cancelled, the access link is closed and the
            refund is confirmed.
          </p>
          <a href="/booking">Book another inspection</a>
        </div>
      ) : null}
      <TechnicalBookingStates
        states={[
          ["Booking", bookingState],
          ["Refund", refundState],
          ["Calendar", calendarState],
          ["Access link", bookingState === "cancelled" ? "revoked" : "active"],
        ]}
      />
    </section>
  );
}

function TechnicalBookingStates({
  states,
}: {
  states: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <details className={styles.technicalDetails}>
      <summary>Technical status</summary>
      <dl className={styles.literalStates} aria-label="Current booking states">
        {states.map(([label, state]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{state}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
