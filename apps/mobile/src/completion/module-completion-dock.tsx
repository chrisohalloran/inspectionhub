import { theme } from "@inspection/theme/tokens";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { CompletionProjection } from "./completion-state";

export function ModuleCompletionDock(
  props: Readonly<{
    projection: CompletionProjection;
    onConfirmPackage: () => void;
    onApproveModule: (module: "building" | "timber_pest") => void;
  }>,
) {
  return (
    <View accessibilityLabel="Inspection completion" style={styles.dock}>
      <Text style={styles.heading}>{props.projection.primaryStatus}</Text>
      {props.projection.manualMode ? (
        <Text accessibilityRole="alert" style={styles.manual}>
          Manual mode — AI is not required to complete or approve the
          inspection.
        </Text>
      ) : null}
      {props.projection.modules.map((module) => (
        <View key={module.module} style={styles.modulePanel}>
          {module.approvalState === "ready" ||
          module.approvalState === "approved" ? (
            <Pressable
              accessibilityHint={`Freezes the current inspector-reviewed ${module.label} snapshot only`}
              accessibilityRole="button"
              accessibilityState={{
                disabled: module.approvalState === "approved",
              }}
              disabled={module.approvalState === "approved"}
              onPress={() => {
                props.onApproveModule(module.module);
              }}
              style={({ pressed }) => [
                styles.approvalButton,
                pressed && styles.pressed,
                module.approvalState === "approved" && styles.disabled,
              ]}
            >
              <Text style={styles.approvalButtonText}>
                {module.approvalState === "approved"
                  ? `${module.label} approved`
                  : `Approve ${module.label}`}
              </Text>
            </Pressable>
          ) : (
            <View style={styles.moduleRow}>
              <Text style={styles.moduleLabel}>{module.label}</Text>
              <Text style={styles.state}>
                {module.approvalState.replaceAll("_", " ")}
              </Text>
            </View>
          )}
        </View>
      ))}
      <Pressable
        accessibilityHint="Freezes the exact approved commissioned module set and queues delivery"
        accessibilityRole="button"
        accessibilityState={{ disabled: !props.projection.canConfirmPackage }}
        disabled={!props.projection.canConfirmPackage}
        onPress={props.onConfirmPackage}
        style={({ pressed }) => [
          styles.button,
          pressed && styles.pressed,
          !props.projection.canConfirmPackage && styles.disabled,
        ]}
      >
        <Text style={styles.buttonText}>Confirm delivery package</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  approvalButton: {
    alignItems: "center",
    backgroundColor: theme.color.surface,
    borderColor: theme.color.outline,
    borderRadius: theme.radius.large,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: theme.target.minimum,
    padding: theme.space[3],
  },
  approvalButtonText: {
    color: theme.color.ink,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  button: {
    alignItems: "center",
    backgroundColor: theme.color.action,
    borderRadius: theme.radius.large,
    justifyContent: "center",
    minHeight: theme.target.minimum,
    padding: theme.space[3],
  },
  buttonText: {
    color: theme.color.surface,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  disabled: { opacity: 0.5 },
  dock: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.outline,
    borderTopWidth: 1,
    gap: theme.space[3],
    padding: theme.space[4],
  },
  heading: { color: theme.color.ink, fontSize: 20, fontWeight: "700" },
  manual: {
    backgroundColor: theme.color.limitationContainer,
    color: theme.color.limitation,
    fontSize: 16,
    lineHeight: 25,
    padding: theme.space[3],
  },
  moduleLabel: { color: theme.color.ink, fontSize: 16, fontWeight: "700" },
  modulePanel: { gap: theme.space[2] },
  moduleRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    minHeight: theme.target.minimum,
  },
  pressed: { backgroundColor: theme.color.actionPressed },
  state: { color: theme.color.inkMuted, fontSize: 16 },
});
