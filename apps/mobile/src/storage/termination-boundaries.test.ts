import { describe, expect, it } from "vitest";

import { expectedResidueAtTermination } from "./termination-boundaries.js";

describe("termination boundary recovery contract", () => {
  it.each([
    [
      "after_copy",
      { acknowledgement: false, final: false, ledger: false, partial: true },
    ],
    [
      "after_durable_sync",
      { acknowledgement: false, final: false, ledger: false, partial: true },
    ],
    [
      "after_hash",
      { acknowledgement: false, final: false, ledger: false, partial: true },
    ],
    [
      "after_rename",
      { acknowledgement: false, final: true, ledger: false, partial: false },
    ],
    [
      "after_sqlite_commit",
      { acknowledgement: false, final: true, ledger: true, partial: false },
    ],
    [
      "after_acknowledgement",
      { acknowledgement: true, final: true, ledger: true, partial: false },
    ],
  ] as const)(
    "models %s without inferring OS process guarantees",
    (boundary, expected) => {
      expect(expectedResidueAtTermination(boundary)).toEqual(expected);
    },
  );
});
