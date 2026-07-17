import { theme } from "@inspection/theme/tokens";
import type {
  InvestigationMeasurementKind,
  InvestigationMeasurementUnit,
} from "@inspection/domain/inspection/mobile";
import { investigationMeasurementValidationError } from "@inspection/domain/inspection/mobile";

const allowedUnits: Readonly<
  Record<InvestigationMeasurementKind, readonly InvestigationMeasurementUnit[]>
> = {
  crack_width: ["millimetres"],
  length: ["millimetres", "metres"],
  level_variation: ["millimetres"],
  moisture_reading: ["percent", "relative_scale"],
  other: ["millimetres", "metres", "percent", "relative_scale", "other"],
};

export const measurementFieldContract = {
  minimumTargetSize: theme.target.minimum,
  maximumSupportedTextScale: 2,
  numericInputLabel: "Measurement value",
  unitInputLabel: "Measurement unit",
  noteInputLabel: "Measurement context (optional)",
} as const;

export function validateMeasurementInput(input: {
  readonly kind: InvestigationMeasurementKind;
  readonly rawValue: string;
  readonly unit: InvestigationMeasurementUnit;
}):
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: string } {
  const normalised = input.rawValue.trim().replace(",", ".");
  if (normalised.length === 0) {
    return { ok: false, error: "Enter a measurement value." };
  }
  const value = Number(normalised);
  if (!Number.isFinite(value)) {
    return { ok: false, error: "Enter a valid finite number." };
  }
  if (!allowedUnits[input.kind].includes(input.unit)) {
    return {
      ok: false,
      error: "Select a unit that matches the measurement type.",
    };
  }
  const validationError = investigationMeasurementValidationError({
    kind: input.kind,
    unit: input.unit,
    value,
  });
  if (validationError !== null) {
    return { ok: false, error: validationError };
  }
  return { ok: true, value };
}

export function unitsForMeasurement(
  kind: InvestigationMeasurementKind,
): readonly InvestigationMeasurementUnit[] {
  return allowedUnits[kind];
}
