import type { ExternalEgressGuard } from "@inspection/security";

import { GoogleCalendarTestAdapter } from "./google-calendar/calendar-adapter.js";
import { ResendTestAdapter } from "./resend/resend-adapter.js";
import { StripeTestAdapter } from "./stripe/stripe-adapter.js";

export type ProviderRuntimeMode = "fake" | "test" | "live";

export function createProviderRuntime(
  mode: ProviderRuntimeMode,
  options: Readonly<{ egressGuard?: ExternalEgressGuard }> = {},
) {
  if (mode === "live") {
    if (options.egressGuard === undefined) {
      throw new Error(
        "Live provider construction requires an explicit external-egress guard",
      );
    }
    throw new Error(
      "Live providers are not available in the Build Week runtime; complete Revenue Activation credential and reconciliation gates first",
    );
  }
  return {
    calendar: new GoogleCalendarTestAdapter(),
    notifications: new ResendTestAdapter(),
    payments: new StripeTestAdapter(),
  };
}
