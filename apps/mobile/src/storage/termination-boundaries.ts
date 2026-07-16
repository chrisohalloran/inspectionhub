export type TerminationBoundary =
  | "after_acknowledgement"
  | "after_copy"
  | "after_durable_sync"
  | "after_hash"
  | "after_rename"
  | "after_sqlite_commit";

export type ExpectedTerminationResidue = {
  acknowledgement: boolean;
  final: boolean;
  ledger: boolean;
  partial: boolean;
};

const expectedResidue: Readonly<
  Record<TerminationBoundary, ExpectedTerminationResidue>
> = {
  after_acknowledgement: {
    acknowledgement: true,
    final: true,
    ledger: true,
    partial: false,
  },
  after_copy: {
    acknowledgement: false,
    final: false,
    ledger: false,
    partial: true,
  },
  after_durable_sync: {
    acknowledgement: false,
    final: false,
    ledger: false,
    partial: true,
  },
  after_hash: {
    acknowledgement: false,
    final: false,
    ledger: false,
    partial: true,
  },
  after_rename: {
    acknowledgement: false,
    final: true,
    ledger: false,
    partial: false,
  },
  after_sqlite_commit: {
    acknowledgement: false,
    final: true,
    ledger: true,
    partial: false,
  },
};

/** A test oracle only; actual residues must be observed on the physical device. */
export function expectedResidueAtTermination(
  boundary: TerminationBoundary,
): ExpectedTerminationResidue {
  return { ...expectedResidue[boundary] };
}
