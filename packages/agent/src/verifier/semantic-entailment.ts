import type { InvestigationPacket } from "@inspection/domain";

import { packetAuthorizesSource } from "../guards.js";
import type {
  DraftClause,
  DraftSourceReference,
  InspectionDraft,
  VerifierIssue,
} from "../schemas.js";

export const DETERMINISTIC_ENTAILMENT_VERSION =
  "deterministic-semantic-entailment-v1";

export interface SemanticEntailmentVerifier {
  readonly version: string;
  verify(input: {
    readonly packet: InvestigationPacket;
    readonly draft: InspectionDraft;
  }): readonly VerifierIssue[];
}

/**
 * A fail-closed lexical entailment boundary. It does not pretend to solve
 * general natural-language inference: it proves that material words, numbers,
 * and polarity in each clause are anchored in its cited structured sources.
 * Clauses that cannot be proven here remain rejected and can only progress
 * through a separately observed live evaluator and inspector review.
 */
export class DeterministicSemanticEntailmentVerifier implements SemanticEntailmentVerifier {
  readonly version = DETERMINISTIC_ENTAILMENT_VERSION;

  verify(input: {
    readonly packet: InvestigationPacket;
    readonly draft: InspectionDraft;
  }): readonly VerifierIssue[] {
    const issues: VerifierIssue[] = [];
    for (const [moduleIndex, module] of input.draft.modules.entries()) {
      const clauses: readonly DraftClause[] = [
        ...module.limitations,
        module.conclusion,
        ...module.findings.flatMap((finding) => [
          finding.observation,
          ...(finding.extent === null ? [] : [finding.extent]),
          ...finding.reasoning,
          ...finding.consequences,
          ...(finding.recommendation === null ? [] : [finding.recommendation]),
        ]),
      ];
      for (const [clauseIndex, clause] of clauses.entries()) {
        const path = `modules[${moduleIndex}].semanticClauses[${clauseIndex}]`;
        const authorised = clause.sourceRefs.filter((source) =>
          packetAuthorizesSource(input.packet, source),
        );
        const sourceTexts = authorised
          .map((source) => sourceText(input.packet, source))
          .filter((text) => text.trim().length > 0);
        if (sourceTexts.length === 0) {
          issues.push(
            critical(
              "semantic_entailment_unverifiable",
              path,
              "Material clause text cannot be proven from a cited structured source",
            ),
          );
          continue;
        }
        const source = sourceTexts.join(" ");
        if (!numbersAreEntailed(clause.text, source)) {
          issues.push(
            critical(
              "invented_numeric_fact",
              path,
              "A numeric claim is absent from the cited packet sources",
            ),
          );
        }
        if (!polarityIsEntailed(clause.text, source)) {
          issues.push(
            critical(
              "invented_negative_fact",
              path,
              "A negative or absence claim is absent from the cited packet sources",
            ),
          );
        }
        if (!materialTermsAreEntailed(clause.text, source)) {
          issues.push(
            critical(
              "unsupported_material_fact",
              path,
              "Material clause content is not semantically anchored in the cited packet sources",
            ),
          );
        }
      }
    }
    return Object.freeze(issues);
  }
}

export function runSemanticEntailmentVerification(
  packet: InvestigationPacket,
  draft: InspectionDraft,
): readonly VerifierIssue[] {
  return new DeterministicSemanticEntailmentVerifier().verify({
    packet,
    draft,
  });
}

function sourceText(
  packet: InvestigationPacket,
  source: DraftSourceReference,
): string {
  switch (source.kind) {
    case "transcript_span":
      return (
        packet.transcriptSpans.find((item) => item.spanId === source.sourceId)
          ?.correctedText ?? ""
      );
    case "observation":
      return (
        packet.observations.find(
          (item) => item.observationId === source.sourceId,
        )?.text ?? ""
      );
    case "measurement": {
      const measurement = packet.measurements.find(
        (item) => item.measurementId === source.sourceId,
      );
      return measurement === undefined
        ? ""
        : `${measurement.value} ${measurement.unit} ${measurement.note ?? ""}`;
    }
    case "limitation":
      return (
        packet.limitations.find((item) => item.limitationId === source.sourceId)
          ?.description ?? ""
      );
    case "coverage":
      return (
        packet.coverage.find((item) => item.coverageEntryId === source.sourceId)
          ?.detail ?? ""
      );
    case "artifact":
      return "";
  }
}

function numbersAreEntailed(clause: string, source: string): boolean {
  const sourceNumbers = new Set(source.match(/\b\d+(?:\.\d+)?\b/gu) ?? []);
  return (clause.match(/\b\d+(?:\.\d+)?\b/gu) ?? []).every((value) =>
    sourceNumbers.has(value),
  );
}

function polarityIsEntailed(clause: string, source: string): boolean {
  const claimsAbsence =
    /\b(?:no|not|none|without|absent|absence|neither)\b/iu.test(clause);
  return (
    !claimsAbsence ||
    /\b(?:no|not|none|without|absent|absence|neither|unknown|unconfirmed|cannot|inaccessible)\b/iu.test(
      source,
    )
  );
}

function materialTermsAreEntailed(clause: string, source: string): boolean {
  const claimTokens = materialTokens(clause);
  if (claimTokens.length === 0) return true;
  const sourceTokens = new Set(materialTokens(source));
  const supported = claimTokens.filter((token) => sourceTokens.has(token));
  const required = claimTokens.length <= 3 ? claimTokens.length : 0;
  return (
    supported.length >= required &&
    supported.length / claimTokens.length >= 0.55
  );
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "by",
  "condition",
  "could",
  "for",
  "from",
  "has",
  "have",
  "in",
  "inspector",
  "inspection",
  "is",
  "it",
  "may",
  "might",
  "of",
  "on",
  "or",
  "possible",
  "possibly",
  "recorded",
  "that",
  "the",
  "this",
  "to",
  "was",
  "were",
  "with",
]);

function materialTokens(value: string): string[] {
  return value
    .toLocaleLowerCase("en-AU")
    .split(/[^a-z0-9]+/u)
    .map(stem)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function stem(token: string): string {
  const aliases: Readonly<Record<string, string>> = {
    cracked: "crack",
    cracking: "crack",
    concealed: "conceal",
    construction: "construct",
    confirmed: "confirm",
    damaged: "damage",
    investigation: "investigate",
    visually: "visible",
  };
  const alias = aliases[token];
  if (alias !== undefined) return alias;
  if (token.length > 5 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function critical(code: string, path: string, message: string): VerifierIssue {
  return { code, severity: "critical", path, message };
}
