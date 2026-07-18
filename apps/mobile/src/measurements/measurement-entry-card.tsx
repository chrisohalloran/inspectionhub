import { theme } from "@inspection/theme/tokens";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import {
  measurementFieldContract,
  unitsForMeasurement,
  validateMeasurementInput,
} from "./measurement-form";
import type {
  InvestigationMeasurementKind,
  InvestigationMeasurementUnit,
} from "@inspection/domain/inspection/mobile";

const kinds: readonly {
  readonly kind: InvestigationMeasurementKind;
  readonly label: string;
}[] = [
  { kind: "crack_width", label: "Crack width" },
  { kind: "moisture_reading", label: "Moisture reading" },
  { kind: "length", label: "Length" },
  { kind: "level_variation", label: "Level variation" },
  { kind: "other", label: "Other" },
];

export type MeasurementEntry = {
  readonly kind: InvestigationMeasurementKind;
  readonly note: string | null;
  readonly unit: InvestigationMeasurementUnit;
  readonly value: number;
};

export function MeasurementEntryCard(props: {
  readonly areaLabel: string;
  readonly onCancel: () => void;
  readonly onSave: (entry: MeasurementEntry) => Promise<void>;
}) {
  const [kind, setKind] = useState<InvestigationMeasurementKind>("crack_width");
  const [unit, setUnit] = useState<InvestigationMeasurementUnit>("millimetres");
  const [rawValue, setRawValue] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function save(): Promise<void> {
    const validation = validateMeasurementInput({ kind, rawValue, unit });
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await props.onSave({
        kind,
        note: note.trim().length === 0 ? null : note.trim(),
        unit,
        value: validation.value,
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Measurement could not be saved locally.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <View
      accessibilityLabel={`Measurement for ${props.areaLabel}`}
      style={styles.card}
    >
      <Text accessibilityRole="header" style={styles.title}>
        Add measurement
      </Text>
      <Text style={styles.body}>
        Save the reading as evidence. You choose the classification later.
      </Text>
      <Text style={styles.label}>Measurement type</Text>
      <View accessibilityRole="radiogroup" style={styles.row}>
        {kinds.map((option) => (
          <Choice
            key={option.kind}
            label={option.label}
            onPress={() => {
              const nextUnits = unitsForMeasurement(option.kind);
              setKind(option.kind);
              setUnit(nextUnits[0]!);
              setError(undefined);
            }}
            selected={kind === option.kind}
          />
        ))}
      </View>
      <Text style={styles.label}>
        {measurementFieldContract.numericInputLabel}
      </Text>
      <TextInput
        accessibilityLabel="Measurement numeric input"
        inputMode="decimal"
        onChangeText={setRawValue}
        placeholder="For example, 1.5"
        placeholderTextColor={theme.color.inkMuted}
        style={styles.valueInput}
        value={rawValue}
      />
      <Text style={styles.label}>
        {measurementFieldContract.unitInputLabel}
      </Text>
      <View accessibilityRole="radiogroup" style={styles.row}>
        {unitsForMeasurement(kind).map((option) => (
          <Choice
            key={option}
            label={option.replaceAll("_", " ")}
            onPress={() => setUnit(option)}
            selected={unit === option}
          />
        ))}
      </View>
      <Text style={styles.label}>
        {measurementFieldContract.noteInputLabel}
      </Text>
      <TextInput
        accessibilityLabel={measurementFieldContract.noteInputLabel}
        multiline
        onChangeText={setNote}
        placeholder="Where and how the reading was taken."
        placeholderTextColor={theme.color.inkMuted}
        style={styles.noteInput}
        value={note}
      />
      {error === undefined ? null : (
        <Text accessibilityLiveRegion="assertive" style={styles.error}>
          {error}
        </Text>
      )}
      <View style={styles.row}>
        <Action
          disabled={saving}
          label={saving ? "Saving measurement" : "Save measurement"}
          onPress={() => void save()}
        />
        <Action disabled={saving} label="Cancel" onPress={props.onCancel} />
      </View>
    </View>
  );
}

function Choice(props: {
  readonly label: string;
  readonly onPress: () => void;
  readonly selected: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: props.selected }}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.choice,
        props.selected && styles.choiceSelected,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.choiceLabel}>
        {props.selected ? `Selected: ${props.label}` : props.label}
      </Text>
    </Pressable>
  );
}

function Action(props: {
  readonly disabled?: boolean;
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.action,
        props.disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.actionLabel}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    backgroundColor: theme.color.surface,
    borderColor: theme.color.outline,
    borderRadius: theme.radius.large,
    borderWidth: 1,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: measurementFieldContract.minimumTargetSize,
    minWidth: theme.component.fieldControlMinimumWidth,
    padding: theme.space[3],
  },
  actionLabel: {
    ...theme.typography.labelLg,
    color: theme.color.ink,
    textAlign: "center",
  },
  body: { ...theme.typography.bodyMd, color: theme.color.inkMuted },
  card: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.outline,
    borderRadius: theme.radius.medium,
    borderWidth: 1,
    gap: theme.space[3],
    marginTop: theme.space[4],
    padding: theme.space[4],
  },
  choice: {
    alignItems: "center",
    backgroundColor: theme.color.surface,
    borderColor: theme.color.outline,
    borderRadius: theme.radius.large,
    borderWidth: 1,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: measurementFieldContract.minimumTargetSize,
    minWidth: theme.component.fieldControlMinimumWidth,
    padding: theme.space[3],
  },
  choiceLabel: {
    ...theme.typography.labelLg,
    color: theme.color.ink,
    textAlign: "center",
  },
  choiceSelected: {
    backgroundColor: theme.color.canvas,
    borderColor: theme.color.action,
    borderWidth: 2,
  },
  disabled: { opacity: 0.55 },
  error: {
    ...theme.typography.bodySm,
    color: theme.color.major,
    fontWeight: "600",
  },
  label: {
    ...theme.typography.bodySm,
    color: theme.color.ink,
    fontWeight: "700",
  },
  noteInput: {
    ...theme.typography.bodyMd,
    borderColor: theme.color.outline,
    borderRadius: theme.radius.medium,
    borderWidth: 1,
    color: theme.color.ink,
    minHeight: theme.component.noteInputMinimumHeight,
    padding: theme.space[3],
    textAlignVertical: "top",
  },
  pressed: { opacity: 0.82 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: theme.space[3] },
  title: {
    ...theme.typography.headlineMd,
    color: theme.color.ink,
  },
  valueInput: {
    ...theme.typography.bodyLg,
    borderColor: theme.color.outline,
    borderRadius: theme.radius.medium,
    borderWidth: 1,
    color: theme.color.ink,
    minHeight: measurementFieldContract.minimumTargetSize,
    padding: theme.space[3],
  },
});
