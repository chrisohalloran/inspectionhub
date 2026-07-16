export type FieldStatusTone = "attention" | "neutral" | "ready";

export type FieldStatus = {
  detail: string;
  label: string;
  tone: FieldStatusTone;
};

export const demoFieldStatuses: readonly FieldStatus[] = [
  {
    detail:
      "Photos and voice notes save locally. Upload waits for a connection.",
    label: "Offline — local capture available",
    tone: "attention",
  },
  {
    detail: "This device is enrolled for the open assigned job.",
    label: "Session active",
    tone: "ready",
  },
  {
    detail: "2.4 GB available. No storage warning.",
    label: "Storage available",
    tone: "neutral",
  },
] as const;

export function fieldStatusAccessibilityLabel(status: FieldStatus): string {
  return `${status.label}. ${status.detail}`;
}
