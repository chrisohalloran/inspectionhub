import { theme } from "@inspection/theme/tokens";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { CompletionProjection } from "./completion-state";
import { packageConfirmationControl } from "./package-confirmation-control";

export function ModuleCompletionDock(
  props: Readonly<{
    busy: boolean;
    packageConfirmed: boolean;
    projection: CompletionProjection;
    onConfirmPackage: () => void;
    onApproveModule: (module: "building" | "timber_pest") => void;
    onWriteManualFinding: () => void;
    manualFindingAvailable: boolean;
  }>,
) {
  const packageControl = packageConfirmationControl({
    busy: props.busy,
    canConfirmPackage: props.projection.canConfirmPackage,
    packageConfirmed: props.packageConfirmed,
  });
  return (
    <View accessibilityLabel="Inspection completion" style={styles.dock}>
      <Text style={styles.heading}>{props.projection.primaryStatus}</Text>
      {props.projection.manualMode ? (
        <Text style={styles.manual}>Manual workflow</Text>
      ) : null}
      {props.projection.manualMode && props.manualFindingAvailable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy: props.busy, disabled: props.busy }}
          disabled={props.busy}
          onPress={props.onWriteManualFinding}
          style={({ pressed }) => [
            styles.approvalButton,
            pressed && styles.pressed,
            props.busy && styles.disabled,
          ]}
        >
          <Text style={styles.approvalButtonText}>Write finding manually</Text>
        </Pressable>
      ) : null}
      {props.projection.modules.map((module) => {
        if (
          module.approvalState !== "ready" &&
          module.approvalState !== "approved"
        ) {
          return null;
        }
        return (
          <View key={module.module} style={styles.modulePanel}>
            <Pressable
              accessibilityHint={`Freezes the current inspector-reviewed ${module.label} snapshot only`}
              accessibilityRole="button"
              accessibilityState={{
                busy: props.busy,
                disabled: props.busy || module.approvalState === "approved",
              }}
              disabled={props.busy || module.approvalState === "approved"}
              onPress={() => {
                props.onApproveModule(module.module);
              }}
              style={({ pressed }) => [
                styles.approvalButton,
                pressed && styles.pressed,
                (props.busy || module.approvalState === "approved") &&
                  styles.disabled,
              ]}
            >
              <Text style={styles.approvalButtonText}>
                {module.approvalState === "approved"
                  ? `${module.label} approved`
                  : `Approve ${module.label}`}
              </Text>
            </Pressable>
          </View>
        );
      })}
      {props.projection.canConfirmPackage || props.packageConfirmed ? (
        <Pressable
          accessibilityHint="Freezes the exact approved commissioned module set and queues delivery"
          accessibilityRole="button"
          accessibilityState={{
            busy: props.busy,
            disabled: packageControl.disabled,
          }}
          disabled={packageControl.disabled}
          onPress={props.onConfirmPackage}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.pressed,
            packageControl.disabled && styles.disabled,
          ]}
        >
          <Text style={styles.buttonText}>{packageControl.label}</Text>
        </Pressable>
      ) : null}
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
    gap: theme.space[2],
    paddingHorizontal: theme.space[4],
    paddingVertical: theme.space[3],
  },
  heading: { color: theme.color.ink, fontSize: 18, fontWeight: "700" },
  manual: {
    color: theme.color.limitation,
    fontSize: 14,
    fontWeight: "600",
  },
  modulePanel: { gap: theme.space[2] },
  pressed: { backgroundColor: theme.color.actionPressed },
});
