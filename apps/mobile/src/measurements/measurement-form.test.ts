import { describe, expect, it } from "vitest";

import {
  measurementFieldContract,
  unitsForMeasurement,
  validateMeasurementInput,
} from "./measurement-form.js";

describe("structured measurement form", () => {
  it("accepts a decimal crack width in millimetres", () => {
    expect(
      validateMeasurementInput({
        kind: "crack_width",
        rawValue: "1.5",
        unit: "millimetres",
      }),
    ).toEqual({ ok: true, value: 1.5 });
  });

  it("rejects mismatched units and non-finite values", () => {
    expect(
      validateMeasurementInput({
        kind: "crack_width",
        rawValue: "1.5",
        unit: "percent",
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateMeasurementInput({
        kind: "moisture_reading",
        rawValue: "Infinity",
        unit: "percent",
      }),
    ).toMatchObject({ ok: false });
  });

  it("rejects negative dimensions and percentage moisture outside zero to one hundred", () => {
    expect(
      validateMeasurementInput({
        kind: "crack_width",
        rawValue: "-0.5",
        unit: "millimetres",
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateMeasurementInput({
        kind: "moisture_reading",
        rawValue: "101",
        unit: "percent",
      }),
    ).toMatchObject({ ok: false });
  });

  it("offers explicit units and accessible large-text controls", () => {
    expect(unitsForMeasurement("moisture_reading")).toEqual([
      "percent",
      "relative_scale",
    ]);
    expect(measurementFieldContract.minimumTargetSize).toBeGreaterThanOrEqual(
      48,
    );
    expect(measurementFieldContract.maximumSupportedTextScale).toBe(2);
  });
});
