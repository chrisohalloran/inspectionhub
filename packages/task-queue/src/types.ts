export type TaskState =
  | "queued"
  | "running"
  | "retry_wait"
  | "succeeded"
  | "unknown"
  | "dead_letter"
  | "superseded"
  | "cancelled";

export interface EnqueueTask {
  readonly taskId?: string;
  readonly organizationId: string;
  readonly taskType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly payloadArtifactId?: string;
  readonly dependencyTaskIds?: readonly string[];
  readonly packetId?: string;
  readonly packetRevision?: number;
  readonly maxAttempts?: number;
  readonly availableAt?: string;
}

export interface AsyncTaskRecord extends Omit<EnqueueTask, "taskId"> {
  readonly taskId: string;
  readonly state: TaskState;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly availableAt: string;
  readonly leaseGeneration: number;
  readonly leaseToken?: string;
  readonly leasedBy?: string;
  readonly leasedUntil?: string;
  readonly heartbeatAt?: string;
  readonly resultArtifactId?: string;
  readonly lastErrorCode?: string;
  readonly supersededByRevision?: number;
  readonly unknownReconciliationHash?: string;
  readonly checkpoints: readonly TaskCheckpoint[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TaskLease {
  readonly task: AsyncTaskRecord;
  readonly generation: number;
  readonly leaseToken: string;
  readonly leasedUntil: string;
}

export interface TaskCheckpoint {
  readonly checkpointId: string;
  readonly name: string;
  readonly artifactRefs: readonly string[];
  readonly metadataHashes: readonly string[];
  readonly recordedAt: string;
}

export interface SafeTaskEvent {
  readonly eventId: string;
  readonly taskId: string;
  readonly organizationId: string;
  readonly eventType:
    | "task.enqueued"
    | "task.replayed"
    | "task.leased"
    | "task.heartbeat"
    | "task.checkpoint"
    | "task.retry_scheduled"
    | "task.completed"
    | "task.unknown"
    | "task.dead_lettered"
    | "task.superseded"
    | "task.cancelled"
    | "tool.requested"
    | "tool.started"
    | "tool.result";
  readonly safeMetadata: Readonly<Record<string, string | number | boolean>>;
  readonly recordedAt: string;
}

export interface LeaseCommand {
  readonly taskId: string;
  readonly generation: number;
  readonly leaseToken: string;
}
