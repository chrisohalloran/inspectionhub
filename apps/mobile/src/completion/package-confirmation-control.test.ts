import { describe, expect, it } from "vitest";

import { packageConfirmationControl } from "./package-confirmation-control.js";

describe("package confirmation control", () => {
  it("cannot recreate or requeue an already confirmed package", () => {
    expect(
      packageConfirmationControl({
        busy: false,
        canConfirmPackage: true,
        packageConfirmed: true,
      }),
    ).toEqual({
      disabled: true,
      label: "Delivery package confirmed",
    });
  });

  it("enables only a ready, idle, unconfirmed package", () => {
    expect(
      packageConfirmationControl({
        busy: false,
        canConfirmPackage: true,
        packageConfirmed: false,
      }).disabled,
    ).toBe(false);
    expect(
      packageConfirmationControl({
        busy: true,
        canConfirmPackage: true,
        packageConfirmed: false,
      }).disabled,
    ).toBe(true);
    expect(
      packageConfirmationControl({
        busy: false,
        canConfirmPackage: false,
        packageConfirmed: false,
      }).disabled,
    ).toBe(true);
  });
});
