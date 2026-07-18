import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BookingFlow } from "./booking-flow";

describe("booking flow UI contract", () => {
  it("renders a separate, labelled module choice and transparent combined quote", () => {
    const html = renderToStaticMarkup(<BookingFlow scenario="standard" />);

    expect(html).toContain("Building inspection");
    expect(html).toContain("Timber Pest inspection");
    expect(html).toContain("Total including GST");
    expect(html).toContain("$715.00");
    expect(html).toContain("Tuesday 21 July 2026");
    expect(html).toContain("Step 1 of 3");
    expect(html).toContain("Property address");
    expect(html).toContain("Use different report or invoice contacts");
    expect(html).not.toContain("property score");
  });

  it("shows payment failure as recoverable without dropping captured people or property", () => {
    const html = renderToStaticMarkup(
      <BookingFlow scenario="payment-declined" />,
    );

    expect(html).toContain("The test payment was declined");
    expect(html).toContain("18 Example Street, Southport QLD 4215");
    expect(html).toContain("alex@example.test");
    expect(html).toContain("Retry payment");
    expect(html).toContain("Property access");
    expect(html).not.toContain("Booking confirmed");
  });

  it("names slot conflict recovery and retains the replacement action", () => {
    const html = renderToStaticMarkup(<BookingFlow scenario="slot-conflict" />);

    expect(html).toContain(
      "Another test client confirmed the original slot first",
    );
    expect(html).toContain("Confirm replacement time");
    expect(html).toContain("Taylor Lee");
  });
});
