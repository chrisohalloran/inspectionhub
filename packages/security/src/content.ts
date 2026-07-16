export function normalizeReportPlainText(
  value: string,
  maximumLength = 4_000,
): string {
  const normalized = value
    .normalize("NFC")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || (code >= 32 && code !== 127);
    })
    .join("")
    .trim();
  if (normalized.length === 0 || normalized.length > maximumLength) {
    throw new Error(
      "Report text must be non-blank and within the configured bound",
    );
  }
  return normalized;
}

export function encodeHtmlText(value: string): string {
  return normalizeReportPlainText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function safeDownloadFilename(input: {
  readonly opaqueReportId: string;
  readonly version: number;
}): string {
  if (!/^[a-zA-Z0-9_-]{16,200}$/u.test(input.opaqueReportId)) {
    throw new Error(
      "Download names must use opaque server-generated identifiers",
    );
  }
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new Error("Report version must be a positive integer");
  }
  return `inspection-report-${input.opaqueReportId}-v${input.version}.pdf`;
}
