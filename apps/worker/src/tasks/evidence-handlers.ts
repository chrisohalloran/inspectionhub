import type {
  ContentQuarantinePipeline,
  InMemorySyncRepository,
} from "@inspection/storage";
import type { TaskHandler } from "@inspection/task-queue";

export function createEvidenceTaskHandlers(options: {
  readonly contentPipeline: ContentQuarantinePipeline;
  readonly repository: InMemorySyncRepository;
}): ReadonlyMap<string, TaskHandler> {
  return new Map<string, TaskHandler>([
    [
      "content.validate_and_proxy",
      async ({ task, checkpoint, assertLease }) => {
        const assessment = await options.contentPipeline.process(
          task.aggregateId,
          {
            assertLease,
          },
        );
        checkpoint({
          name:
            assessment.state === "accepted"
              ? "content.safe_proxy_persisted"
              : "content.quarantine_terminal",
          artifactRefs:
            assessment.safeProxyArtifactId === undefined
              ? [assessment.artifactId]
              : [assessment.artifactId, assessment.safeProxyArtifactId],
        });
        return assessment.safeProxyArtifactId === undefined
          ? {}
          : { resultArtifactId: assessment.safeProxyArtifactId };
      },
    ],
    [
      "evidence.reconcile",
      ({ task, checkpoint }) => {
        checkpoint({
          name: "reconciliation.request_recorded",
          artifactRefs: [task.payloadArtifactId ?? task.aggregateId],
        });
        return Promise.resolve({});
      },
    ],
  ]);
}
