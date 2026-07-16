import type { InvestigationPacket } from "@inspection/domain";
import { sha256 } from "@inspection/domain";

import { runDeterministicDraftGuard } from "../guards.js";
import type { DraftVerification, InspectionDraft } from "../schemas.js";
import {
  DeterministicSemanticEntailmentVerifier,
  type SemanticEntailmentVerifier,
} from "./semantic-entailment.js";

export const DETERMINISTIC_VERIFIER_VERSION = "deterministic-verifier-v2";

export class ReadOnlyDraftVerifier {
  readonly #semantic: SemanticEntailmentVerifier;

  constructor(
    semantic: SemanticEntailmentVerifier = new DeterministicSemanticEntailmentVerifier(),
  ) {
    this.#semantic = semantic;
  }

  verify(input: {
    readonly packet: InvestigationPacket;
    readonly draft: InspectionDraft;
    readonly verifiedAt: string;
  }): DraftVerification {
    const draftHash = sha256(input.draft);
    const result = runDeterministicDraftGuard(input.packet, input.draft);
    const issues = [
      ...result.issues,
      ...this.#semantic.verify({ packet: input.packet, draft: input.draft }),
    ];
    return Object.freeze({
      verifierVersion: `${DETERMINISTIC_VERIFIER_VERSION}+${this.#semantic.version}`,
      packetHash: input.packet.canonicalHash,
      draftHash,
      passed: !issues.some((issue) => issue.severity === "critical"),
      issues,
      verifiedAt: input.verifiedAt,
    });
  }
}
