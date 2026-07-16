import {
  InMemoryApprovalService,
  InMemoryInspectorAuthority,
} from "@inspection/approvals";
import {
  buildingModuleSnapshotFixture,
  domainFixtureIds,
  timberPestModuleSnapshotFixture,
} from "@inspection/test-fixtures/domain";
import type { CommissionedModules } from "@inspection/contracts";
import { InMemoryModuleSnapshotStore } from "@inspection/reporting/snapshot";
import { describe, expect, it } from "vitest";

import { DeliveryPackageService } from "./delivery-service.js";
import { FakeDeliveryProvider } from "./fake-delivery-provider.js";
import { createDurabilityManifest } from "./manifest.js";
import { InMemoryDeliveryRepository } from "./repository.js";
import {
  DeliveryWorker,
  InMemoryProfessionalDeliveryStatus,
} from "./worker.js";

const at = "2026-07-15T03:00:00.000Z";
const packageId = "50000000-0000-4000-8000-000000000901";
const manifestId = "50000000-0000-4000-8000-000000000902";
const moduleSet: CommissionedModules = ["building", "timber_pest"];
const buildingKey = {
  organizationId: domainFixtureIds.organizationId,
  jobId: domainFixtureIds.jobId,
  module: "building" as const,
};
const pestKey = { ...buildingKey, module: "timber_pest" as const };

function setup(options: { approvePest?: boolean } = {}) {
  const snapshots = new InMemoryModuleSnapshotStore();
  const building = snapshots.create(buildingModuleSnapshotFixture(1), 0);
  const pest = snapshots.create(timberPestModuleSnapshotFixture(1), 0);
  const authority = new InMemoryInspectorAuthority();
  for (const key of [buildingKey, pestKey]) {
    authority.set(key, {
      assignedInspectorId: domainFixtureIds.inspectorId,
      eligible: true,
      credentialVersion: "fixture-credential-v1",
    });
  }
  const approvals = new InMemoryApprovalService(snapshots, authority);
  approve(approvals, building);
  if (options.approvePest ?? true) approve(approvals, pest);
  const repository = new InMemoryDeliveryRepository();
  const service = new DeliveryPackageService(repository, snapshots, approvals);
  return { snapshots, approvals, repository, service };
}

function approve(
  approvals: InMemoryApprovalService,
  snapshot: ReturnType<InMemoryModuleSnapshotStore["create"]>,
) {
  return approvals.approve({
    organizationId: snapshot.organizationId,
    jobId: snapshot.jobId,
    module: snapshot.module,
    snapshotId: snapshot.snapshotId,
    snapshotHash: snapshot.canonicalHash,
    expectedModuleRevision: 0,
    inspectorId: domainFixtureIds.inspectorId,
    credentialVersion: "fixture-credential-v1",
    recentAuthentication: true,
    idempotencyKey: `approve:${snapshot.module}`,
    approvedAt: at,
  });
}

function manifest(status: "verified" | "missing" = "verified", revision = 1) {
  return createDurabilityManifest({
    manifestId,
    organizationId: domainFixtureIds.organizationId,
    jobId: domainFixtureIds.jobId,
    revision,
    entries: [
      {
        artifactId: domainFixtureIds.artifactId,
        contentHash: "a".repeat(64),
        byteLength: 1_024,
        requiredOriginal: true,
        status,
        verifiedAt: status === "verified" ? at : null,
      },
    ],
  });
}

function confirm(
  context: ReturnType<typeof setup>,
  options: {
    expectedPackageRevision?: number;
    manifestStatus?: "verified" | "missing";
    idempotencyKey?: string;
  } = {},
) {
  return context.service.confirm({
    packageId,
    organizationId: domainFixtureIds.organizationId,
    jobId: domainFixtureIds.jobId,
    commissionedModules: moduleSet,
    manifest: manifest(
      options.manifestStatus,
      (options.expectedPackageRevision ?? 0) + 1,
    ),
    expectedPackageRevision: options.expectedPackageRevision ?? 0,
    idempotencyKey: options.idempotencyKey ?? "confirm:1",
    confirmedAt: at,
  });
}

function queuedContext() {
  const context = setup();
  const result = confirm(context);
  expect(result.outcome).toBe("queued");
  return context;
}

describe("guarded delivery package confirmation", () => {
  it("keeps a combined package pending with no partial snapshot set", () => {
    const context = setup({ approvePest: false });
    const result = confirm(context);

    expect(result.outcome).toBe("waiting_for_approval");
    expect(result.blockers).toEqual(["timber_pest_not_approved"]);
    expect(result.package.moduleSnapshots).toEqual([]);
    expect(context.repository.getOutboxForPackage(packageId)).toBeUndefined();
  });

  it("shows evidence synchronising and freezes nothing until originals are durable", () => {
    const context = setup();
    const pending = confirm(context, { manifestStatus: "missing" });

    expect(pending.outcome).toBe("waiting_for_evidence");
    expect(pending.package.moduleSnapshots).toEqual([]);
    expect(context.repository.getOutboxForPackage(packageId)).toBeUndefined();

    const queued = confirm(context, {
      expectedPackageRevision: 1,
      manifestStatus: "verified",
      idempotencyKey: "confirm:durable",
    });
    expect(queued.outcome).toBe("queued");
    expect(queued.package.moduleSnapshots.map(({ module }) => module)).toEqual(
      moduleSet,
    );
    expect(context.repository.getOutboxForPackage(packageId)?.state).toBe(
      "queued",
    );
  });

  it("atomically freezes exact current approvals, manifest and one outbox", () => {
    const context = setup();
    const first = confirm(context);
    const replay = confirm(context);

    expect(first.package.moduleSnapshots).toHaveLength(2);
    expect(first.package.frozenAt).toBe(at);
    expect(Object.isFrozen(first.package.moduleSnapshots)).toBe(true);
    expect(replay.replayed).toBe(true);
    expect(replay.package).toStrictEqual(first.package);
    expect(
      context.repository
        .events()
        .filter(({ type }) => type === "delivery.package_frozen"),
    ).toHaveLength(1);
  });

  it("fails closed when an approval no longer matches the current snapshot", () => {
    const context = setup();
    context.snapshots.create(buildingModuleSnapshotFixture(2), 1);

    expect(() => confirm(context)).toThrow(
      "approval is not for the exact current snapshot",
    );
    expect(context.repository.getPackage(packageId)).toBeUndefined();
  });

  it("does not queue when the manifest omits approved snapshot evidence", () => {
    const context = setup();
    const incomplete = createDurabilityManifest({
      manifestId,
      organizationId: domainFixtureIds.organizationId,
      jobId: domainFixtureIds.jobId,
      revision: 1,
      entries: [],
    });
    const result = context.service.confirm({
      packageId,
      organizationId: domainFixtureIds.organizationId,
      jobId: domainFixtureIds.jobId,
      commissionedModules: moduleSet,
      manifest: incomplete,
      expectedPackageRevision: 0,
      idempotencyKey: "confirm:omitted-evidence",
      confirmedAt: at,
    });

    expect(result.outcome).toBe("waiting_for_evidence");
    expect(result.package.moduleSnapshots).toEqual([]);
    expect(context.repository.getOutboxForPackage(packageId)).toBeUndefined();
  });

  it("does not substitute a verified derivative for a required original", () => {
    const context = setup();
    const derivativeOnly = createDurabilityManifest({
      manifestId,
      organizationId: domainFixtureIds.organizationId,
      jobId: domainFixtureIds.jobId,
      revision: 1,
      entries: [
        {
          artifactId: domainFixtureIds.artifactId,
          contentHash: "a".repeat(64),
          byteLength: 512,
          requiredOriginal: false,
          status: "verified",
          verifiedAt: at,
        },
      ],
    });
    const result = context.service.confirm({
      packageId,
      organizationId: domainFixtureIds.organizationId,
      jobId: domainFixtureIds.jobId,
      commissionedModules: moduleSet,
      manifest: derivativeOnly,
      expectedPackageRevision: 0,
      idempotencyKey: "confirm:derivative-only",
      confirmedAt: at,
    });

    expect(result.outcome).toBe("waiting_for_evidence");
    expect(context.repository.getOutboxForPackage(packageId)).toBeUndefined();
  });

  it("rejects a tampered durability manifest before package mutation", () => {
    const context = setup();
    const valid = manifest();
    const tampered = { ...valid, revision: 99 };

    expect(() =>
      context.service.confirm({
        packageId,
        organizationId: domainFixtureIds.organizationId,
        jobId: domainFixtureIds.jobId,
        commissionedModules: moduleSet,
        manifest: tampered,
        expectedPackageRevision: 0,
        idempotencyKey: "confirm:tampered",
        confirmedAt: at,
      }),
    ).toThrow("does not match its canonical hash");
    expect(context.repository.getPackage(packageId)).toBeUndefined();
  });
});

describe("literal delivery worker outcomes", () => {
  const allowEgress = {
    async requireEgress(): Promise<void> {
      await Promise.resolve();
    },
  };

  it("records sent only from an observed provider sent result", async () => {
    const context = queuedContext();
    const status = new InMemoryProfessionalDeliveryStatus();
    const provider = new FakeDeliveryProvider("sent");
    const worker = new DeliveryWorker(
      context.repository,
      status,
      provider,
      allowEgress,
      () => at,
    );

    const sent = await worker.send(packageId);

    expect(sent.state).toBe("sent");
    expect(provider.requests).toHaveLength(1);
    expect(context.repository.getOutboxForPackage(packageId)?.state).toBe(
      "completed",
    );
  });

  it("keeps provider acceptance distinct from sent confirmation", async () => {
    const context = queuedContext();
    const status = new InMemoryProfessionalDeliveryStatus();
    const worker = new DeliveryWorker(
      context.repository,
      status,
      new FakeDeliveryProvider("accepted"),
      allowEgress,
      () => at,
    );

    const accepted = await worker.send(packageId);
    expect(accepted.state).toBe("provider_accepted");

    const sent = worker.markProviderSent(packageId, "callback:sent");
    expect(sent.state).toBe("sent");
  });

  it("retains observed provider truth when sent confirmation follows cancellation", async () => {
    const context = queuedContext();
    const status = new InMemoryProfessionalDeliveryStatus();
    const worker = new DeliveryWorker(
      context.repository,
      status,
      new FakeDeliveryProvider("accepted"),
      allowEgress,
      () => at,
    );
    expect((await worker.send(packageId)).state).toBe("provider_accepted");
    expect(worker.cancelPackage(packageId, "module_withdrawn").state).toBe(
      "cancelled",
    );

    const observed = worker.markProviderSent(packageId, "late-sent-callback");
    expect(observed.state).toBe("sent");
    expect(observed.cancellationReason).toBe("module_withdrawn");
    expect(
      context.repository.events().at(-1)?.safeMetadata
        .observedAfterCancellation,
    ).toBe(true);
  });

  it("rechecks withdrawal immediately before provider call", async () => {
    const context = queuedContext();
    const status = new InMemoryProfessionalDeliveryStatus();
    const provider = new FakeDeliveryProvider("sent");
    const worker = new DeliveryWorker(
      context.repository,
      status,
      provider,
      allowEgress,
      () => at,
    );

    const result = await worker.send(packageId, {
      beforeProviderCall: () => {
        status.set(domainFixtureIds.organizationId, domainFixtureIds.jobId, {
          jobCancelled: false,
          withdrawnModules: ["building"],
        });
      },
    });

    expect(result.state).toBe("cancelled");
    expect(result.cancellationReason).toBe("module_withdrawn");
    expect(provider.requests).toHaveLength(0);
  });

  it("does not call a provider after a committed package cancellation race", async () => {
    const context = queuedContext();
    const status = new InMemoryProfessionalDeliveryStatus();
    const provider = new FakeDeliveryProvider("sent");
    const worker = new DeliveryWorker(
      context.repository,
      status,
      provider,
      allowEgress,
      () => at,
    );

    const result = await worker.send(packageId, {
      beforeProviderCall: () => {
        worker.cancelPackage(packageId, "delivery_suspended");
      },
    });

    expect(result.state).toBe("cancelled");
    expect(provider.requests).toHaveLength(0);
  });

  it("does not call a provider when a module is withdrawn while egress authorisation is awaiting", async () => {
    const context = queuedContext();
    const status = new InMemoryProfessionalDeliveryStatus();
    const provider = new FakeDeliveryProvider("sent");
    let authorisationStarted!: () => void;
    let finishAuthorisation!: () => void;
    const authorisationPending = new Promise<void>((resolve) => {
      authorisationStarted = resolve;
    });
    const authorisationGate = new Promise<void>((resolve) => {
      finishAuthorisation = resolve;
    });
    const worker = new DeliveryWorker(
      context.repository,
      status,
      provider,
      {
        async requireEgress(): Promise<void> {
          authorisationStarted();
          await authorisationGate;
        },
      },
      () => at,
    );

    const send = worker.send(packageId);
    await authorisationPending;
    status.set(domainFixtureIds.organizationId, domainFixtureIds.jobId, {
      jobCancelled: false,
      withdrawnModules: ["building"],
    });
    finishAuthorisation();
    const result = await send;

    expect(result.state).toBe("cancelled");
    expect(result.cancellationReason).toBe("module_withdrawn");
    expect(provider.requests).toHaveLength(0);
    expect(context.repository.getOutboxForPackage(packageId)?.state).toBe(
      "cancelled",
    );
  });

  it("enters unknown reconciliation if provider result is lost before logging", async () => {
    const context = queuedContext();
    const status = new InMemoryProfessionalDeliveryStatus();
    const provider = new FakeDeliveryProvider("sent");
    const worker = new DeliveryWorker(
      context.repository,
      status,
      provider,
      allowEgress,
      () => at,
    );

    const result = await worker.send(packageId, {
      afterProviderCall: () => {
        throw new Error("process terminated");
      },
    });

    expect(result.state).toBe("unknown");
    expect(result.failureCode).toBe("provider_outcome_unknown");
    expect(provider.requests).toHaveLength(1);
  });

  it("fails closed immediately before provider delivery when restore egress is blocked", async () => {
    const context = queuedContext();
    const status = new InMemoryProfessionalDeliveryStatus();
    const provider = new FakeDeliveryProvider("sent");
    const worker = new DeliveryWorker(
      context.repository,
      status,
      provider,
      {
        async requireEgress(): Promise<void> {
          await Promise.resolve();
          throw new Error("restore generation is blocked");
        },
      },
      () => at,
    );

    const result = await worker.send(packageId);

    expect(result).toMatchObject({
      state: "failed",
      failureCode: "restore_egress_blocked",
      interventionRequired: false,
    });
    expect(provider.requests).toHaveLength(0);
    expect(context.repository.getOutboxForPackage(packageId)?.state).toBe(
      "queued",
    );
  });

  it("retries transient failures but requires intervention for terminal failures", async () => {
    const retryContext = queuedContext();
    const status = new InMemoryProfessionalDeliveryStatus();
    const retryWorker = new DeliveryWorker(
      retryContext.repository,
      status,
      new FakeDeliveryProvider("retryable_failure"),
      allowEgress,
      () => at,
    );
    const failed = await retryWorker.send(packageId);
    expect(failed).toMatchObject({
      state: "failed",
      interventionRequired: false,
    });
    expect(retryWorker.retry(packageId).state).toBe("queued");

    const terminalContext = queuedContext();
    const terminalWorker = new DeliveryWorker(
      terminalContext.repository,
      status,
      new FakeDeliveryProvider("terminal_failure"),
      allowEgress,
      () => at,
    );
    const terminal = await terminalWorker.send(packageId);
    expect(terminal).toMatchObject({
      state: "failed",
      interventionRequired: true,
    });
    expect(() => terminalWorker.retry(packageId)).toThrow(
      "retryable failed delivery",
    );
  });
});
