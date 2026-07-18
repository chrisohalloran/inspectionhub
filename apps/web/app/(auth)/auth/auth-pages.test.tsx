import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import InvitationPage from "./invitation/page";
import VerifyMailboxPage from "./verify/page";

describe("recipient demo authentication copy", () => {
  it("states that the public demo does not send email", async () => {
    const invitation = renderToStaticMarkup(
      await InvitationPage({ searchParams: Promise.resolve({}) }),
    );
    const verification = renderToStaticMarkup(
      await VerifyMailboxPage({ searchParams: Promise.resolve({}) }),
    );

    expect(invitation).toContain("No email is sent from this public demo");
    expect(verification).toContain("No email is sent from this public demo");
    expect(verification).toContain("Demo verification code:");
    expect(verification).not.toContain("code we sent");
  });
});
