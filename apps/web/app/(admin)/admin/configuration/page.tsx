import Link from "next/link";

import { AdminConfiguration } from "./admin-configuration";
import styles from "./admin.module.css";

type AdminPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminConfigurationPage({
  searchParams,
}: AdminPageProps) {
  const params = await searchParams;
  const scenario = Array.isArray(params.scenario)
    ? params.scenario[0]
    : params.scenario;
  const permissionDenied = scenario === "permission-denied";

  return (
    <main className={styles.page}>
      <header className={styles.masthead}>
        <div>
          <Link className={styles.brand} href="/">
            InspectionHub
          </Link>
          <span className={styles.environment}>Test environment</span>
        </div>
        <nav aria-label="Administration">
          <a aria-current="page" href="#services">
            Services
          </a>
          <a href="#availability">Availability</a>
          <a href="#eligibility">Inspectors</a>
          <a href="#integrations">Integrations</a>
        </nav>
      </header>
      <AdminConfiguration permissionDenied={permissionDenied} />
      <details className={styles.releaseBoundary}>
        <summary>Demo administration controls</summary>
        <p>
          Agreement, notification, and report-presentation templates remain
          reviewed release artifacts. This launch surface does not expose broad
          template editors.
        </p>
        <Link
          href={
            permissionDenied
              ? "/admin/configuration"
              : "/admin/configuration?scenario=permission-denied"
          }
        >
          {permissionDenied
            ? "Return to authorised view"
            : "Preview permission-denied state"}
        </Link>
      </details>
    </main>
  );
}
