import { theme } from "@inspection/theme/tokens";

export const fieldControls = {
  manualNote: {
    hint: "Records an observation when camera, microphone, or storage capture is unavailable",
    label: "Add manual note",
  },
  photo: {
    hint: "Saves a coverage photo locally without asking for classification",
    label: "Take photo",
  },
  voice: {
    hint: "Records a voice note independently of photo uploads",
    label: "Record voice note",
  },
} as const;

export const fieldShellAccessibilityContract = {
  minimumTargetSize: theme.target.minimum,
  supportsDynamicType: true,
  usesTextForOperationalState: true,
} as const;
