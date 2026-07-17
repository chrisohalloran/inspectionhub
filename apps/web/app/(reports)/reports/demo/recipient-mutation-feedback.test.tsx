// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContactInspector } from "./contact-inspector";
import { ShareAccess } from "./share-access";

const proposedExpiry = Date.now() + 60_000;

describe("recipient mutation feedback", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it.each(["share", "contact"] as const)(
    "renders the permanent lifetime cap in the %s client",
    async (client) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            failureResponse(409, "grant_mutation_limit_reached"),
          ),
      );
      renderClient(root, client);
      await submit(container, client);

      expect(container.textContent).toContain(
        client === "share"
          ? "This access has reached its lifetime invitation limit. No more invitations can be recorded from this access."
          : "This access has reached its lifetime question limit. No more questions can be recorded from this access.",
      );
      expect(container.textContent).not.toContain("Refresh and try again");
    },
  );

  it.each(["share", "contact"] as const)(
    "renders the temporary retry window from Retry-After in the %s client",
    async (client) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            failureResponse(429, "report_mutation_window_reached", "120"),
          ),
      );
      renderClient(root, client);
      await submit(container, client);

      expect(container.textContent).toContain(
        client === "share"
          ? "Invitation requests are temporarily limited. Try again in 2 minutes."
          : "Question requests are temporarily limited. Try again in 2 minutes.",
      );
    },
  );
});

function renderClient(root: Root, client: "share" | "contact") {
  act(() => {
    root.render(
      client === "share" ? (
        <ShareAccess initialInvitations={[]} proposedExpiry={proposedExpiry} />
      ) : (
        <ContactInspector
          availableModules={["building", "timber_pest"]}
          initialRequests={[]}
        />
      ),
    );
  });
}

async function submit(container: HTMLDivElement, client: "share" | "contact") {
  if (client === "share") {
    const input = container.querySelector<HTMLInputElement>("#share-email");
    if (input === null) throw new Error("Share email input is missing");
    input.value = "buyer@example.com";
  } else {
    const textarea =
      container.querySelector<HTMLTextAreaElement>("#contact-message");
    if (textarea === null) throw new Error("Contact message input is missing");
    textarea.value = "Please clarify this finding.";
  }
  const form = container.querySelector("form");
  if (form === null) throw new Error("Recipient form is missing");
  await act(async () => {
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
  });
}

function failureResponse(status: number, error: string, retryAfter?: string) {
  return {
    headers: new Headers(
      retryAfter === undefined ? undefined : { "retry-after": retryAfter },
    ),
    json: () => Promise.resolve({ error }),
    ok: false,
    status,
  } as Response;
}
