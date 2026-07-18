import styles from "../auth.module.css";

export default async function InvitationPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ error?: string }>;
}>) {
  const { error } = await searchParams;
  return (
    <main className={styles.shell}>
      <section className={styles.card} aria-labelledby="invitation-heading">
        <p className={styles.eyebrow}>Secure report access</p>
        <h1 id="invitation-heading">Open your inspection report</h1>
        <p>
          Enter the Build Week demo invitation code and email address below. No
          email is sent from this public demo.
        </p>
        {error === "unavailable" ? (
          <p className={styles.error} role="alert">
            This invitation is unavailable, expired, revoked, or already used.
          </p>
        ) : null}
        {error === "rate-limited" ? (
          <p className={styles.error} role="alert">
            Too many attempts were made. Wait a moment, then try this page
            again.
          </p>
        ) : null}
        {error === "temporarily-unavailable" ? (
          <p className={styles.error} role="alert">
            Secure report access is temporarily unavailable. Your invitation has
            not been used; try again shortly.
          </p>
        ) : null}
        <form
          className={styles.form}
          action="/auth/invitation/redeem"
          method="post"
        >
          <div className={styles.field}>
            <label htmlFor="invitation-token">Invitation code</label>
            <input
              autoComplete="one-time-code"
              id="invitation-token"
              name="invitationToken"
              required
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="recipient-email">Email address</label>
            <input
              autoComplete="email"
              id="recipient-email"
              name="email"
              required
              type="email"
              defaultValue="recipient@example.com"
            />
          </div>
          <button type="submit">Continue</button>
        </form>
        <details className={styles.demoHelp}>
          <summary>Demo invitation details</summary>
          <p>
            Use <strong>demo-invite-</strong> followed by any unique value and
            the email <strong>recipient@example.com</strong>.
          </p>
        </details>
        <p className={styles.securityNote}>
          Access is limited to the invited email address and the report version
          shared with you.
        </p>
      </section>
    </main>
  );
}
