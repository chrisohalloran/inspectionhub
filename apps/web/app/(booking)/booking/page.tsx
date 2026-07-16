import Link from "next/link";

import { BookingFlow } from "./booking-flow";
import { resolveScenario } from "./booking-model";
import styles from "./booking.module.css";

type BookingPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function BookingPage({ searchParams }: BookingPageProps) {
  const params = await searchParams;
  const scenario = resolveScenario(params.scenario);

  return (
    <main className={styles.page}>
      <header className={styles.masthead}>
        <Link className={styles.brand} href="/">
          See It Inspections
        </Link>
        <p className={styles.environment}>
          Synthetic Build Week journey · no real booking or charge
        </p>
      </header>
      <BookingFlow scenario={scenario} />
      <aside
        className={styles.scenarioPanel}
        aria-labelledby="scenario-heading"
      >
        <div>
          <p className={styles.eyebrow}>Recovery fixtures</p>
          <h2 id="scenario-heading">
            Check the paths that usually cause phone calls
          </h2>
          <p>
            Each link loads the same de-identified details into a recoverable
            state so input preservation is visible.
          </p>
        </div>
        <nav aria-label="Synthetic booking scenarios">
          <Link href="/booking?scenario=payment-declined">
            Payment declined
          </Link>
          <Link href="/booking?scenario=slot-expired">Slot expired</Link>
          <Link href="/booking?scenario=slot-conflict">Slot conflict</Link>
        </nav>
      </aside>
    </main>
  );
}
