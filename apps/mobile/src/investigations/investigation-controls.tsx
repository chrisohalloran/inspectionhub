import { theme } from "@inspection/theme/tokens";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  deriveInvestigationShellView,
  investigationFieldControls,
  investigationShellAccessibilityContract,
  type VoiceControlState,
} from "./field-shell-contract";
import type { InvestigationStatus } from "@inspection/domain/inspection/types";

export type InvestigationControlDockProps = {
  readonly currentAreaLabel: string;
  readonly investigationStatus: InvestigationStatus | "none";
  readonly operationStatus: string;
  readonly recentCaptureCount: number;
  readonly voiceState: VoiceControlState;
  readonly onPhoto: () => void;
  readonly onVoice: () => void;
  readonly onInvestigationAction: () => void;
  readonly onAttachRecent: () => void;
  readonly onChangeArea: () => void;
  readonly onFinish: () => void;
};

export function InvestigationControlDock(props: InvestigationControlDockProps) {
  const view = deriveInvestigationShellView(props);
  const hasOpenInvestigation =
    props.investigationStatus === "active" ||
    props.investigationStatus === "paused";
  return (
    <View accessibilityLabel="Field capture controls" style={styles.dock}>
      <View accessible style={styles.context}>
        <Text style={styles.metadata}>Current area</Text>
        <Text style={styles.area}>{view.currentAreaLabel}</Text>
        <Text accessibilityLiveRegion="polite" style={styles.status}>
          {view.investigationStatusLabel}. {view.voiceStateLabel}.
        </Text>
      </View>
      <Text accessibilityLiveRegion="polite" style={styles.operationStatus}>
        {props.operationStatus}
      </Text>
      <Pressable
        accessibilityHint={investigationFieldControls.photo.hint}
        accessibilityRole="button"
        onPress={props.onPhoto}
        style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
      >
        <Text style={styles.primaryLabel}>
          {investigationFieldControls.photo.label}
        </Text>
      </Pressable>
      <View style={styles.row}>
        <Control
          hint={investigationFieldControls.voice.hint}
          label={view.voiceLabel}
          onPress={props.onVoice}
        />
        <Control
          hint={investigationFieldControls.investigation.hint}
          label={view.investigationActionLabel}
          onPress={props.onInvestigationAction}
        />
      </View>
      {hasOpenInvestigation ? (
        <View style={styles.row}>
          {view.attachRecentLabel === null ? null : (
            <Control
              hint={investigationFieldControls.attachRecent.hint}
              label={view.attachRecentLabel}
              onPress={props.onAttachRecent}
            />
          )}
          <Control
            hint={investigationFieldControls.changeArea.hint}
            label={investigationFieldControls.changeArea.label}
            onPress={props.onChangeArea}
          />
          {view.finishAvailable ? (
            <Control
              hint={investigationFieldControls.finish.hint}
              label={investigationFieldControls.finish.label}
              onPress={props.onFinish}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Control(props: {
  readonly hint: string;
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityHint={props.hint}
      accessibilityRole="button"
      onPress={props.onPress}
      style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
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
  metadata: {
    color: theme.color.inkMuted,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 21,
  },
  operationStatus: {
    color: theme.color.ink,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
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
  status: { color: theme.color.inkMuted, fontSize: 14, lineHeight: 21 },
});
