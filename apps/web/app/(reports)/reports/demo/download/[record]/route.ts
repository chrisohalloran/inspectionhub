import {
  createSyntheticRecipientReport,
  generateModulePdf,
} from "@inspection/reporting/web";
import { NextResponse } from "next/server";

import {
  authorisePortalRequest,
  readPortalSession,
} from "../../../_lib/recipient-session";

export async function GET(
  _request: Request,
  context: { params: Promise<{ record: string }> },
) {
  const { record } = await context.params;
  const snapshot = createSyntheticRecipientReport();
  const module =
    record === "building"
      ? ("building" as const)
      : record === "timber-pest"
        ? ("timber_pest" as const)
        : null;
  const session = await readPortalSession();
  try {
    if (module === null) {
      await authoriseRecordDownload(session, snapshot.reportVersionId);
    } else {
      await authorisePortalRequest(session, {
        reportVersionId: snapshot.reportVersionId,
        module,
        action: "download_pdf",
      });
    }
  } catch {
    return NextResponse.json({ error: "access_denied" }, { status: 403 });
  }

  if (record === "building" || record === "timber-pest") {
    const reportModule = module ?? "building";
    const artifact = generateModulePdf(snapshot, reportModule);
    try {
      await authorisePortalRequest(session, {
        reportVersionId: snapshot.reportVersionId,
        module: reportModule,
        action: "download_pdf",
      });
    } catch {
      return NextResponse.json({ error: "access_denied" }, { status: 403 });
    }
    return new NextResponse(Uint8Array.from(artifact.bytes).buffer, {
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "content-disposition": `attachment; filename="${artifact.fileName}"`,
        "content-type": artifact.mediaType,
        etag: `"${artifact.contentHash}"`,
      },
    });
  }

  if (record !== "agreement" && record !== "invoice") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const content =
    record === "agreement"
      ? [
          "Signed inspection agreement record",
          snapshot.propertyLabel,
          "Report package version 2",
          "Executed 14 July 2026",
          "Synthetic Build Week demonstration record",
        ].join("\n")
      : [
          "Invoice record",
          snapshot.propertyLabel,
          "Invoice DEMO-1002",
          "Status: paid in test mode",
          "Synthetic Build Week demonstration record",
        ].join("\n");
  try {
    await authoriseRecordDownload(session, snapshot.reportVersionId);
  } catch {
    return NextResponse.json({ error: "access_denied" }, { status: 403 });
  }
  return new NextResponse(content, {
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "content-disposition": `attachment; filename="${record}-report-v2.txt"`,
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

async function authoriseRecordDownload(
  session: Awaited<ReturnType<typeof readPortalSession>>,
  reportVersionId: string,
): Promise<void> {
  for (const module of ["building", "timber_pest"] as const) {
    try {
      await authorisePortalRequest(session, {
        reportVersionId,
        module,
        action: "download_pdf",
      });
      return;
    } catch {
      // Non-module records remain available if either delivered module is active.
    }
  }
  throw new Error("access_denied");
}
