import { theme } from "@inspection/theme/tokens";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { coverageOptions, type CoverageOption } from "./coverage-options";

type ModuleType = "building" | "timber_pest";

export type AreaCloseoutSelection = {
  readonly detail: string;
  readonly module: ModuleType;
  readonly state: CoverageOption["state"];
};

export function AreaCloseoutCard(props: {
  readonly areaLabel: string;
  readonly initialModule?: ModuleType;
  readonly onCancel: () => void;
  readonly onSave: (selection: AreaCloseoutSelection) => Promise<void>;
  readonly summaries: readonly string[];
}) {
  const [module, setModule] = useState<ModuleType>(
    props.initialModule ?? "building",
  );
  const [state, setState] = useState<CoverageOption["state"]>("inspected");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const selectedOption = coverageOptions.find(
    (option) => option.state === state,
  )!;
  const detailRequired = selectedOption.requiresDetail;
  const saveDisabled = saving || (detailRequired && detail.trim().length === 0);

  async function save(): Promise<void> {
    if (saveDisabled) return;
    setSaving(true);
    setError(undefined);
    try {
      await props.onSave({ detail: detail.trim(), module, state });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Coverage could not be saved locally.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <View
      accessibilityLabel={`Area close-out for ${props.areaLabel}`}
      style={styles.card}
    >
      <Text accessibilityRole="header" style={styles.title}>
        Close out {props.areaLabel}
      </Text>
      <Text style={styles.body}>
        Record the inspector’s coverage judgement separately for each
        commissioned module. Photo count never determines coverage.
      </Text>
      {props.summaries.length === 0 ? (
        <Text style={styles.metadata}>No coverage judgement recorded yet.</Text>
      ) : (
        props.summaries.map((summary) => (
          <Text key={summary} style={styles.metadata}>
            {summary}
          </Text>
        ))
      )}
      <Text style={styles.label}>Professional module</Text>
      <View style={styles.row}>
        <Choice
          label="Building"
          onPress={() => setModule("building")}
          selected={module === "building"}
        />
        <Choice
          label="Timber Pest"
          onPress={() => setModule("timber_pest")}
          selected={module === "timber_pest"}
        />
      </View>
      <Text style={styles.label}>Coverage state</Text>
      <View style={styles.row}>
        {coverageOptions.map((option) => (
          <Choice
            key={option.state}
            hint={option.hint}
            label={option.label}
            onPress={() => {
              setState(option.state);
              setError(undefined);
            }}
            selected={state === option.state}
          />
        ))}
      </View>
      <Text style={styles.label}>
        Coverage detail {detailRequired ? "(required)" : "(optional)"}
      </Text>
      <TextInput
        accessibilityLabel="Coverage detail input"
        multiline
        onChangeText={setDetail}
        placeholder="Describe any limitation, reason, revisit need, or useful coverage context."
        placeholderTextColor={theme.color.inkMuted}
        style={styles.input}
        value={detail}
      />
      {error === undefined ? null : (
        <Text accessibilityLiveRegion="assertive" style={styles.error}>
          {error}
        </Text>
      )}
      <View style={styles.row}>
        <Action
          disabled={saveDisabled}
          label={saving ? "Saving coverage" : "Save coverage"}
          onPress={() => void save()}
        />
        <Action
          disabled={saving}
          label={saving ? "Saving coverage" : "Cancel close-out"}
          onPress={props.onCancel}
        />
      </View>
    </View>
  );
}

function Choice(props: {
  readonly hint?: string;
  readonly label: string;
  readonly onPress: () => void;
  readonly selected: boolean;
}) {
  return (
    <Pressable
      accessibilityHint={props.hint}
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.choice,
        props.selected && styles.choiceSelected,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.choiceLabel}>
        {props.label}
        {props.selected ? " — selected" : ""}
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
    minHeight: theme.target.minimum,
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
    minHeight: theme.target.minimum,
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
  input: {
    ...theme.typography.bodyMd,
    borderColor: theme.color.outline,
    borderRadius: theme.radius.medium,
    borderWidth: 1,
    color: theme.color.ink,
    minHeight: theme.component.detailInputMinimumHeight,
    padding: theme.space[3],
    textAlignVertical: "top",
  },
  label: {
    ...theme.typography.bodySm,
    color: theme.color.ink,
    fontWeight: "700",
  },
  metadata: { ...theme.typography.bodySm, color: theme.color.inkMuted },
  pressed: { opacity: 0.82 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: theme.space[3] },
  title: {
    ...theme.typography.headlineMd,
    color: theme.color.ink,
  },
});
