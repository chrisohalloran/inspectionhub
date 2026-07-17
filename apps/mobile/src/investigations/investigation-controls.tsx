import { theme } from "@inspection/theme/tokens";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  compactOperationStatus,
  deriveInvestigationShellView,
  investigationFieldControls,
  investigationShellAccessibilityContract,
  type DockOperationState,
  type VoiceControlState,
} from "./field-shell-contract";
import type { InvestigationStatus } from "@inspection/domain/inspection/types";

export type InvestigationControlDockProps = {
  readonly captureEnabled: boolean;
  readonly currentAreaLabel: string;
  readonly investigationStatus: InvestigationStatus | "none";
  readonly investigationActionBusy: boolean;
  readonly operationStatus: string;
  readonly operationState: DockOperationState;
  readonly photoBusy: boolean;
  readonly recentCaptureCount: number;
  readonly voiceState: VoiceControlState;
  readonly onPhoto: () => void;
  readonly onVoice: () => void;
  readonly onInvestigationAction: () => void;
};

export function InvestigationControlDock(props: InvestigationControlDockProps) {
  const view = deriveInvestigationShellView(props);
  return (
    <View accessibilityLabel="Field capture controls" style={styles.dock}>
      <View style={styles.context}>
        <View
          accessible
          accessibilityLabel={`Current area ${view.currentAreaLabel}. ${view.investigationStatusLabel}. ${view.voiceStateLabel}. ${compactOperationStatus(props.operationState)}. ${props.operationStatus}`}
        >
          <Text style={styles.metadata}>Current area</Text>
          <Text style={styles.area}>{view.currentAreaLabel}</Text>
          <Text accessibilityLiveRegion="polite" style={styles.status}>
            {compactOperationStatus(props.operationState)}
          </Text>
        </View>
      </View>
      <Pressable
        accessibilityHint={investigationFieldControls.photo.hint}
        accessibilityRole="button"
        accessibilityState={{
          disabled: !props.captureEnabled || props.photoBusy,
        }}
        disabled={!props.captureEnabled || props.photoBusy}
        onPress={props.onPhoto}
        style={({ pressed }) => [
          styles.primary,
          (!props.captureEnabled || props.photoBusy) && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.primaryLabel}>
          {props.photoBusy
            ? "Saving photo"
            : investigationFieldControls.photo.label}
        </Text>
      </Pressable>
      <View style={styles.row}>
        <Control
          disabled={
            !props.captureEnabled ||
            props.voiceState === "starting" ||
            props.voiceState === "saving" ||
            props.voiceState === "unavailable"
          }
          hint={investigationFieldControls.voice.hint}
          label={view.voiceLabel}
          onPress={props.onVoice}
        />
        <Control
          busy={props.investigationActionBusy}
          disabled={!props.captureEnabled || props.investigationActionBusy}
          hint={investigationFieldControls.investigation.hint}
          label={view.investigationActionLabel}
          onPress={props.onInvestigationAction}
        />
      </View>
    </View>
  );
}

function Control(props: {
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly hint: string;
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityHint={props.hint}
      accessibilityRole="button"
      accessibilityState={{ busy: props.busy, disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.secondary,
        props.disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.secondaryLabel}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  area: {
    color: theme.color.ink,
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 26,
  },
  context: { gap: theme.space[1] },
  dock: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.outline,
    borderTopWidth: 1,
    gap: theme.space[3],
    padding: theme.space[4],
  },
  disabled: { opacity: 0.55 },
  metadata: {
    color: theme.color.inkMuted,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 21,
  },
  pressed: { backgroundColor: theme.color.canvas },
  primary: {
    alignItems: "center",
    backgroundColor: theme.color.action,
    borderRadius: theme.radius.large,
    justifyContent: "center",
    minHeight: investigationShellAccessibilityContract.minimumTargetSize,
    padding: theme.space[3],
  },
  primaryLabel: {
    color: theme.color.surface,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: theme.space[3] },
  secondary: {
    alignItems: "center",
    backgroundColor: theme.color.surface,
    borderColor: theme.color.outline,
    borderRadius: theme.radius.large,
    borderWidth: 1,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: investigationShellAccessibilityContract.minimumTargetSize,
    minWidth: 132,
    padding: theme.space[3],
  },
  secondaryLabel: {
    color: theme.color.ink,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  status: {
    color: theme.color.inkMuted,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 21,
  },
});
