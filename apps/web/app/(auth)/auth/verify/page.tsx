import Link from "next/link";

import styles from "../auth.module.css";

export default async function VerifyMailboxPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ error?: string }>;
}>) {
  const { error } = await searchParams;
  return (
    <main className={styles.shell}>
      <section className={styles.card} aria-labelledby="verify-heading">
        <p className={styles.eyebrow}>Build Week demo</p>
        <h1 id="verify-heading">Enter the demo verification code</h1>
        <p>
          No email is sent from this public demo. Use the six-digit code shown
          below.
        </p>
        {error === "invalid" ? (
          <p className={styles.error} role="alert">
            The code is incorrect, expired, or already used. Restart from the
            invitation.
          </p>
        ) : null}
        {error === "rate-limited" ? (
          <p className={styles.error} role="alert">
            Too many codes were tried. Wait a moment, then try again.
          </p>
        ) : null}
        {error === "temporarily-unavailable" ? (
          <p className={styles.error} role="alert">
            Verification is temporarily unavailable. Your report access has not
            changed; try again shortly.
          </p>
        ) : null}
        <form
          className={styles.form}
          action="/auth/verify/complete"
          method="post"
        >
          <div className={styles.field}>
            <label htmlFor="mailbox-code">Verification code</label>
            <input
              autoComplete="one-time-code"
              id="mailbox-code"
              inputMode="numeric"
              maxLength={6}
              minLength={6}
              name="otp"
              pattern="[0-9]{6}"
              required
            />
          </div>
          <button type="submit">Open report</button>
        </form>
        <Link className={styles.restartLink} href="/auth/invitation">
          Start again with the invitation email
        </Link>
        <div className={styles.demoHelp}>
          <p>
            Demo verification code: <strong>482913</strong>
          </p>
        </div>
      </section>
    </main>
  );
}
