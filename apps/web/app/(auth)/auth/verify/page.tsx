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
        <p className={styles.eyebrow}>Fresh mailbox check</p>
        <h1 id="verify-heading">Enter the six-digit email code</h1>
        <p>
          This separate step confirms that the current person can access the
          mailbox named by the invitation.
        </p>
        {error === "invalid" ? (
          <p className={styles.error} role="alert">
            The code is incorrect, expired, or already used. Restart from the
            invitation.
          </p>
        ) : null}
        <form
          className={styles.form}
          action="/auth/verify/complete"
          method="post"
        >
          <div className={styles.field}>
            <label htmlFor="mailbox-code">Email code</label>
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
            <p className={styles.help}>Synthetic demo code: 482913.</p>
          </div>
          <button type="submit">Verify and open report</button>
        </form>
      </section>
    </main>
  );
}
