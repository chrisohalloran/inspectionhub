import { consumeBoundaryRateLimit } from "../rate-limit";
import { createAccessWebhookHandler } from "./handler";

export const POST = createAccessWebhookHandler({
  consumeRateLimit: consumeBoundaryRateLimit,
});
