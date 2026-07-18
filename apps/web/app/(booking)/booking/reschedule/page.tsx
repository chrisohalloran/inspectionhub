import Link from "next/link";

import { RescheduleFlow } from "../change-booking-flow";
import styles from "../booking.module.css";

export const dynamic = "force-dynamic";

export default function ReschedulePage() {
  return (
    <main className={styles.page}>
      <header className={styles.masthead}>
        <Link className={styles.brand} href="/booking">
          See It Inspections
        </Link>
        <p className={styles.environment}>Build Week demo</p>
      </header>
      <RescheduleFlow />
    </main>
  );
}
