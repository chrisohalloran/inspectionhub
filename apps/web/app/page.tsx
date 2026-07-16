import { demoJob } from "@inspection/test-fixtures";
import { headers } from "next/headers";
import Link from "next/link";

type Surface = {
  eyebrow: string;
  heading: string;
  summary: string;
  action: string;
};

function resolveSurface(host: string): Surface {
  if (host.includes("seeitinspections")) {
    return {
      eyebrow: "See It Inspections",
      heading: "Clear property condition, without the industry shorthand.",
      summary:
        "Book a combined inspection and receive separate Building and Timber Pest reports.",
      action: "Start a test booking",
    };
  }
  if (host.includes("buildingpestinspectiongoldcoast")) {
    return {
      eyebrow: "Gold Coast Building & Pest Inspections",
      heading: "Independent visual inspection for an informed decision.",
      summary:
        "A focused acquisition surface that routes into the shared booking experience.",
      action: "View inspection service",
    };
  }
  return {
    eyebrow: "InspectionHub",
    heading: "Finish the inspection onsite.",
    summary:
      "Capture evidence, investigate possible defects, approve each module and queue delivery.",
    action: "Open inspector workspace",
  };
}

export default async function HomePage() {
  const requestHeaders = await headers();
  const surface = resolveSurface(
    requestHeaders.get("host") ?? "inspectionhub.localhost",
  );

  return (
    <main>
      <section className="hero" aria-labelledby="page-heading">
        <p className="eyebrow">{surface.eyebrow}</p>
        <h1 id="page-heading">{surface.heading}</h1>
        <p className="summary">{surface.summary}</p>
        <Link className="primary-link" href="/booking">
          {surface.action}
        </Link>
      </section>
      <section className="module-preview" aria-labelledby="demo-heading">
        <div>
          <p className="eyebrow">Synthetic demo</p>
          <h2 id="demo-heading">{demoJob.propertyLabel}</h2>
          <p>Two independently governed modules share one evidence record.</p>
        </div>
        <ul aria-label="Commissioned modules">
          <li data-module="building">Building report</li>
          <li data-module="timber-pest">Timber Pest report</li>
        </ul>
      </section>
    </main>
  );
}
