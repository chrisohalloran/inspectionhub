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
        <p className={styles.environment}>Build Week demo</p>
      </header>
      <BookingFlow scenario={scenario} />
      <details className={styles.scenarioPanel}>
        <summary>Demo recovery scenarios</summary>
        <div className={styles.scenarioContent}>
          <p>
            Check how the booking recovers from the issues that usually cause a
            phone call. Entered details remain available in every scenario.
          </p>
          <nav aria-label="Synthetic booking scenarios">
            <Link href="/booking?scenario=payment-declined">
              Payment declined
            </Link>
            <Link href="/booking?scenario=slot-expired">Slot expired</Link>
            <Link href="/booking?scenario=slot-conflict">Slot conflict</Link>
          </nav>
        </div>
      </details>
    </main>
  );
}
