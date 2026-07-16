import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AdminConfiguration } from "./admin-configuration";

describe("admin configuration UI contract", () => {
  it("contains only the launch controls with literal provider and authority states", () => {
    const html = renderToStaticMarkup(
      <AdminConfiguration permissionDenied={false} />,
    );

    expect(html).toContain("Services and pricing");
    expect(html).toContain("Availability");
    expect(html).toContain("Inspector eligibility");
    expect(html).toContain("Integrations");
    expect(html).toContain("Calendar stale");
    expect(html).toContain("Test environment · no live credentials");
    expect(html).not.toContain("Template editor");
  });

  it("renders permission denial as a named state and disables mutation controls", () => {
    const html = renderToStaticMarkup(<AdminConfiguration permissionDenied />);

    expect(html).toContain("Permission denied");
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).toContain("cannot publish or operate provider controls");
  });
});
