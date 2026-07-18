import { consumeBoundaryRateLimit } from "../rate-limit";
import { createBookingWebhookHandler } from "./handler";

export const POST = createBookingWebhookHandler({
  consumeRateLimit: consumeBoundaryRateLimit,
});
