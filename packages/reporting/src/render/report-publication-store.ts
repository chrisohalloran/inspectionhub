import type { PdfArtifact } from "../pdf/pdf-renderer.js";
import { deepFreezeReport } from "./report-canonical.js";
import type {
  ReportModule,
  ReportSnapshot,
  ReportSnapshotInput,
} from "./report-types.js";
import { createReportSnapshot } from "./report-types.js";

export type ReportRenderer = (
  snapshot: ReportSnapshot,
  module: ReportModule,
) => PdfArtifact;

export type PublishedReportVersion = Readonly<{
  snapshot: ReportSnapshot;
  pdfs: Readonly<Partial<Record<ReportModule, PdfArtifact>>>;
  publishedAt: string;
}>;

export type ReportWithdrawalNotice = Readonly<{
  withdrawalId: string;
  reportVersionId: string;
  module: ReportModule;
  withdrawnAt: string;
  withdrawnBy: string;
  reason: string;
  replacementReportVersionId: string | null;
}>;

export class ReportPublicationConflictError extends Error {
  readonly code = "report_publication_conflict";

  constructor(message: string) {
    super(message);
    this.name = "ReportPublicationConflictError";
  }
}

export class InMemoryReportPublicationStore {
  readonly #byId = new Map<string, PublishedReportVersion>();
  readonly #currentByJob = new Map<string, string>();
  readonly #historyByJob = new Map<string, readonly string[]>();
  readonly #withdrawals: ReportWithdrawalNotice[] = [];

  publish(
    input: ReportSnapshotInput,
    renderer: ReportRenderer,
  ): PublishedReportVersion {
    const jobKey = `${input.organizationId}:${input.jobId}`;
    const currentId = this.#currentByJob.get(jobKey);
    if (this.#byId.has(input.reportVersionId)) {
      throw new ReportPublicationConflictError(
        "A report version identity cannot be reused",
      );
    }
    if (input.amendment !== null) {
      if (
        currentId === undefined ||
        input.amendment.priorReportVersionId !== currentId
      ) {
        throw new ReportPublicationConflictError(
          "An amendment must replace the exact current immutable version",
        );
      }
    } else if (currentId !== undefined) {
      throw new ReportPublicationConflictError(
        "A later report version requires an amendment notice",
      );
    }

    const snapshot = createReportSnapshot(input);
    const modules: ReportModule[] = [
      ...(snapshot.building === null ? [] : (["building"] as const)),
      ...(snapshot.timberPest === null ? [] : (["timber_pest"] as const)),
    ];

    // Render every formal record before mutating the current pointer. A failed
    // renderer therefore leaves the prior published version untouched.
    const rendered = Object.fromEntries(
      modules.map((module) => [module, renderer(snapshot, module)] as const),
    ) as Partial<Record<ReportModule, PdfArtifact>>;
    const published = deepFreezeReport({
      snapshot,
      pdfs: deepFreezeReport(rendered),
      publishedAt: input.issuedAt,
    });
    this.#byId.set(snapshot.reportVersionId, published);
    this.#currentByJob.set(jobKey, snapshot.reportVersionId);
    this.#historyByJob.set(
      jobKey,
      deepFreezeReport([
        ...(this.#historyByJob.get(jobKey) ?? []),
        snapshot.reportVersionId,
      ]),
    );
    return published;
  }

  current(
    organizationId: string,
    jobId: string,
  ): PublishedReportVersion | null {
    const currentId = this.#currentByJob.get(`${organizationId}:${jobId}`);
    return currentId === undefined ? null : (this.#byId.get(currentId) ?? null);
  }

  byId(reportVersionId: string): PublishedReportVersion | null {
    return this.#byId.get(reportVersionId) ?? null;
  }

  history(
    organizationId: string,
    jobId: string,
  ): readonly PublishedReportVersion[] {
    return (this.#historyByJob.get(`${organizationId}:${jobId}`) ?? []).map(
      (reportVersionId) => {
        const version = this.#byId.get(reportVersionId);
        if (version === undefined) {
          throw new Error(
            "Report history references a missing immutable version",
          );
        }
        return version;
      },
    );
  }

  withdraw(notice: ReportWithdrawalNotice): ReportWithdrawalNotice {
    if (this.#byId.get(notice.reportVersionId) === undefined) {
      throw new ReportPublicationConflictError(
        "A withdrawal must reference an immutable report version",
      );
    }
    if (
      this.#withdrawals.some(
        ({ withdrawalId }) => withdrawalId === notice.withdrawalId,
      )
    ) {
      throw new ReportPublicationConflictError(
        "A withdrawal identity cannot be reused",
      );
    }
    const stored = deepFreezeReport({ ...notice });
    this.#withdrawals.push(stored);
    return stored;
  }

  withdrawal(
    reportVersionId: string,
    module: ReportModule,
  ): ReportWithdrawalNotice | null {
    return (
      this.#withdrawals.findLast(
        (notice) =>
          notice.reportVersionId === reportVersionId &&
          notice.module === module,
      ) ?? null
    );
  }
}
