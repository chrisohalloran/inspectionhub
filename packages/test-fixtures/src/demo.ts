export const demoActors = {
  inspector: {
    id: "actor_inspector_demo",
    role: "inspector",
    displayName: "Alex Inspector",
  },
  client: {
    id: "actor_client_demo",
    role: "client",
    displayName: "Casey Client",
  },
  recipient: {
    id: "actor_recipient_demo",
    role: "recipient",
    displayName: "Riley Recipient",
  },
  accessContact: {
    id: "actor_access_demo",
    role: "access_contact",
    displayName: "Morgan Access",
  },
} as const;

export const demoJob = {
  id: "job_demo_cracked_tile",
  propertyLabel: "Synthetic two-storey dwelling",
  commissionedModules: ["building", "timber_pest"] as const,
  fixtureClassification: "synthetic_deidentified",
} as const;
