import { describe, expect, it } from "vitest";

import {
  AgreementTemplateVersionSchema,
  verifySignedAgreementSnapshot,
  signAgreement,
} from "./index.js";

const ids = {
  agreementId: "20000000-0000-4000-8000-000000000001",
  bookingId: "20000000-0000-4000-8000-000000000002",
  clientAssignmentId: "20000000-0000-4000-8000-000000000003",
  clientContactId: "20000000-0000-4000-8000-000000000004",
  organizationId: "20000000-0000-4000-8000-000000000005",
  templateId: "20000000-0000-4000-8000-000000000006",
};

const template = AgreementTemplateVersionSchema.parse({
  templateId: ids.templateId,
  version: 3,
  status: "published",
  publishedAt: "2026-07-14T08:00:00.000+10:00",
  title: "Pre-inspection agreement",
  introductoryText: "Please review the commissioned inspection scope.",
  building: {
    heading: "Building inspection scope",
    body: "A visual pre-purchase building inspection.",
  },
  timberPest: {
    heading: "Timber pest inspection scope",
    body: "A separate visual timber pest inspection scope.",
  },
  acknowledgementText: "I have reviewed both scope sections.",
});

describe("signed agreement snapshots", () => {
  it("freezes the exact combined-service template version and separate scope sections", () => {
    const snapshot = signAgreement({
      agreementId: ids.agreementId,
      bookingId: ids.bookingId,
      organizationId: ids.organizationId,
      template,
      commissionedModules: ["building", "timber_pest"],
      signer: {
        assignmentId: ids.clientAssignmentId,
        contactId: ids.clientContactId,
        name: "Casey Client",
        email: "casey@example.test",
      },
      typedName: "Casey Client",
      acknowledgementAccepted: true,
      signedAt: "2026-07-14T08:30:00.000+10:00",
    });

    expect(snapshot.templateVersion).toBe(3);
    expect(snapshot.scopeSections.map((section) => section.module)).toEqual([
      "building",
      "timber_pest",
    ]);
    expect(snapshot.scopeSections[0]?.heading).not.toBe(
      snapshot.scopeSections[1]?.heading,
    );
    expect(verifySignedAgreementSnapshot(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("rejects a combined agreement when either commissioned scope is absent", () => {
    const incompleteTemplate = {
      ...template,
      timberPest: null,
    };

    expect(() =>
      signAgreement({
        agreementId: ids.agreementId,
        bookingId: ids.bookingId,
        organizationId: ids.organizationId,
        template: incompleteTemplate,
        commissionedModules: ["building", "timber_pest"],
        signer: {
          assignmentId: ids.clientAssignmentId,
          contactId: ids.clientContactId,
          name: "Casey Client",
          email: "casey@example.test",
        },
        typedName: "Casey Client",
        acknowledgementAccepted: true,
        signedAt: "2026-07-14T08:30:00.000+10:00",
      }),
    ).toThrow(/Timber Pest scope/i);
  });
});
