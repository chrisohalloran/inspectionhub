import { redirect } from "next/navigation";

import { demoPortalState, readPortalSession } from "../_lib/recipient-session";
import { DemoReportContent } from "./report-content";

export default async function DemoReportPage() {
  const session = await readPortalSession();
  let portalState: Awaited<ReturnType<typeof demoPortalState>>;
  try {
    if (session === null) throw new Error("recipient_session_missing");
    portalState = await demoPortalState(session);
  } catch {
    redirect("/auth/invitation");
  }

  return <DemoReportContent portalState={portalState} session={session} />;
}
