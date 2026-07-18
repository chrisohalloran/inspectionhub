import { consumeBoundaryRateLimit } from "../../../../api/webhooks/rate-limit";
import { createOtpVerificationHandler } from "./handler";

export const POST = createOtpVerificationHandler({
  consumeRateLimit: consumeBoundaryRateLimit,
});
