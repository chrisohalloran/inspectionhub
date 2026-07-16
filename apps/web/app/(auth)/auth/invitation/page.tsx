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
        <p className={styles.eyebrow}>See It Inspections report access</p>
        <h1 id="invitation-heading">Open your named invitation</h1>
        <p>
          The invitation identifies the synthetic report access fixture. Your
          mailbox is verified separately before any report content is shown.
        </p>
        {error === "unavailable" ? (
          <p className={styles.error} role="alert">
            This invitation is unavailable, expired, revoked, or already used.
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
            <p className={styles.help} id="invitation-help">
              Synthetic demo code: demo-invite-followed-by-any-unique-value.
            </p>
          </div>
          <div className={styles.field}>
            <label htmlFor="recipient-email">Invited email address</label>
            <input
              autoComplete="email"
              id="recipient-email"
              name="email"
              required
              type="email"
              defaultValue="recipient@example.com"
            />
          </div>
          <button type="submit">Continue to mailbox verification</button>
        </form>
        <p className={styles.help}>
          Forwarding this invitation does not transfer report access. Access is
          fixed to the named mailbox, report version, modules, actions and
          expiry.
        </p>
      </section>
    </main>
  );
}
