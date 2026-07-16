import { deepFreeze } from "@inspection/domain";

import {
  QuoteRuleVersionSchema,
  QuoteSnapshotSchema,
  type PropertyQuoteInput,
  type QuoteRuleVersion,
  type QuoteSnapshot,
} from "./schemas.js";

export function publishQuoteRuleVersion(
  input: QuoteRuleVersion,
  publishedAt: string,
): QuoteRuleVersion {
  const draft = QuoteRuleVersionSchema.parse(input);
  if (draft.status !== "draft" || draft.publishedAt !== null) {
    throw new Error(
      "Only an unpublished draft quote rule version can be published",
    );
  }
  return deepFreeze(
    QuoteRuleVersionSchema.parse({
      ...draft,
      status: "published",
      publishedAt,
    }),
  );
}

export function createQuote(
  input: Readonly<{
    quoteId: string;
    rules: QuoteRuleVersion;
    commissionedModules:
      | readonly ["building"]
      | readonly ["timber_pest"]
      | readonly ["building", "timber_pest"];
    property: PropertyQuoteInput;
    createdAt: string;
    expiresAt: string;
  }>,
): QuoteSnapshot {
  const rules = QuoteRuleVersionSchema.parse(input.rules);
  if (rules.status !== "published" || rules.publishedAt === null) {
    throw new Error("Quotes require a published quote rule version");
  }
  if (Date.parse(input.expiresAt) <= Date.parse(input.createdAt)) {
    throw new Error("Quote expiry must be after quote creation");
  }
  const lineItems = input.commissionedModules.map((module) => {
    const rule = module === "building" ? rules.building : rules.timberPest;
    return {
      module,
      label: rule.label,
      amountCents:
        rule.baseAmountCents +
        Math.max(0, input.property.storeys - 1) *
          rule.additionalStoreyAmountCents +
        Math.max(0, input.property.bedrooms - 4) *
          rule.additionalBedroomOverFourAmountCents,
    };
  });
  return deepFreeze(
    QuoteSnapshotSchema.parse({
      quoteId: input.quoteId,
      ruleSetId: rules.ruleSetId,
      ruleVersion: rules.version,
      commissionedModules: input.commissionedModules,
      property: input.property,
      currency: rules.currency,
      lineItems,
      totalAmountCents: lineItems.reduce(
        (total, lineItem) => total + lineItem.amountCents,
        0,
      ),
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
    }),
  );
}
