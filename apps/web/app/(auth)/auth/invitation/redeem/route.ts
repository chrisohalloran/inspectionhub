import { consumeBoundaryRateLimit } from "../../../../api/webhooks/rate-limit";
import { createInvitationRedemptionHandler } from "./handler";

export const POST = createInvitationRedemptionHandler({
  consumeRateLimit: consumeBoundaryRateLimit,
});
