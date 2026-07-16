import { deepFreeze, sha256 } from "@inspection/domain";

import {
  AgreementTemplateVersionSchema,
  SignedAgreementSnapshotInputSchema,
  SignedAgreementSnapshotSchema,
  type AgreementTemplateVersion,
  type SignedAgreementSnapshot,
} from "./schemas.js";

export type SignAgreementInput = Readonly<{
  agreementId: string;
  bookingId: string;
  organizationId: string;
  template: AgreementTemplateVersion;
  commissionedModules:
    | readonly ["building"]
    | readonly ["timber_pest"]
    | readonly ["building", "timber_pest"];
  signer: Readonly<{
    assignmentId: string;
    contactId: string;
    name: string;
    email: string;
  }>;
  typedName: string;
  acknowledgementAccepted: true;
  signedAt: string;
}>;

export function signAgreement(
  input: SignAgreementInput,
): SignedAgreementSnapshot {
  const template = AgreementTemplateVersionSchema.parse(input.template);
  if (template.status !== "published" || template.publishedAt === null) {
    throw new Error(
      "Only a published agreement template version can be signed",
    );
  }
  if (input.typedName.trim() !== input.signer.name.trim()) {
    throw new Error("The typed signature name must match the signer snapshot");
  }
  const scopeSections = input.commissionedModules.map((module) => {
    const section =
      module === "building" ? template.building : template.timberPest;
    if (section === null) {
      throw new Error(
        module === "building"
          ? "The Building scope is required for this agreement"
          : "The Timber Pest scope is required for this agreement",
      );
    }
    return { module, ...section };
  });
  const snapshotInput = SignedAgreementSnapshotInputSchema.parse({
    agreementId: input.agreementId,
    bookingId: input.bookingId,
    organizationId: input.organizationId,
    templateId: template.templateId,
    templateVersion: template.version,
    templateTitle: template.title,
    introductoryText: template.introductoryText,
    commissionedModules: input.commissionedModules,
    scopeSections,
    acknowledgementText: template.acknowledgementText,
    acknowledgementAccepted: input.acknowledgementAccepted,
    signer: input.signer,
    typedName: input.typedName,
    signatureMethod: "typed_name_and_acknowledgement",
    signedAt: input.signedAt,
  });
  return deepFreeze(
    SignedAgreementSnapshotSchema.parse({
      ...snapshotInput,
      canonicalHash: sha256(snapshotInput),
    }),
  );
}

export function verifySignedAgreementSnapshot(
  snapshot: SignedAgreementSnapshot,
): boolean {
  const parsed = SignedAgreementSnapshotSchema.parse(snapshot);
  const { canonicalHash, ...snapshotInput } = parsed;
  return (
    sha256(SignedAgreementSnapshotInputSchema.parse(snapshotInput)) ===
    canonicalHash
  );
}
