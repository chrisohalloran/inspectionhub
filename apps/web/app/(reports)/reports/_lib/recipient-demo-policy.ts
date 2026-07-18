export const DEMO_SHARE_REQUEST_LIMIT = 5;
export const DEMO_CONTACT_REQUEST_LIMIT = 5;
export const DEMO_REPORT_SHARE_WINDOW_LIMIT = 25;
export const DEMO_REPORT_CONTACT_WINDOW_LIMIT = 25;
export const DEMO_REPORT_MUTATION_WINDOW_MS = 60 * 60_000;

const RESERVED_DEMO_EMAIL = /^[a-z0-9][a-z0-9._+-]{0,63}@example\.com$/u;

export function canonicalReservedDemoEmail(value: string): string {
  const email = value.trim().toLocaleLowerCase("en-AU");
  if (!RESERVED_DEMO_EMAIL.test(email)) {
    throw new Error("A reserved synthetic recipient address is required");
  }
  return email;
}
