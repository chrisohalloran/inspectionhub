import { theme } from "@inspection/theme/tokens";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  reviewDisclosure,
  type InvestigationReviewItem,
} from "./investigation-review";
import { reviewActions, type ReviewAction } from "./review-screen-contract";

export type InvestigationReviewCardProps = Readonly<{
  item: InvestigationReviewItem;
  onAccept: () => void;
  onEdit: () => void;
  onReject: () => void;
  onReverify: () => void;
  onContinueHuman: () => void;
}>;

export function InvestigationReviewCard(props: InvestigationReviewCardProps) {
  const disclosure = reviewDisclosure(props.item);
  const actions = reviewActions(props.item);
  const handlers: Record<ReviewAction["id"], () => void> = {
    accept: props.onAccept,
    edit: props.onEdit,
    reject: props.onReject,
    reverify: props.onReverify,
    continue_human: props.onContinueHuman,
  };
  const moduleLabel =
    props.item.module === "building" ? "Building" : "Timber Pest";
  const status =
    props.item.status === "awaiting_decision"
      ? "Review required"
      : props.item.status.replaceAll("_", " ");

  return (
    <View
      accessibilityLabel={`${moduleLabel} investigation finding, ${status}`}
      style={styles.card}
    >
      <View style={styles.labelRow}>
        <Text
          style={
            props.item.module === "building"
              ? styles.buildingLabel
              : styles.pestLabel
          }
        >
          {moduleLabel}
        </Text>
        <Text style={styles.reviewLabel}>
          {disclosure.origin === "AI suggested"
            ? "AI suggestion — review required"
            : "Inspector authored"}
        </Text>
      </View>

      <Text style={styles.heading}>{props.item.finding.content.location}</Text>
      <Field
        label="Observation"
        value={props.item.finding.content.observation}
      />
      <Field
        label="Apparent extent"
        value={props.item.finding.content.apparentExtent}
      />
      <Field
        label="Qualified opinion"
        value={props.item.finding.content.qualifiedOpinion}
      />

      {disclosure.uncertainty.length > 0 ? (
        <List label="Uncertainty" values={disclosure.uncertainty} />
      ) : null}
      {disclosure.assumptions.length > 0 ? (
        <List label="Assumptions to confirm" values={disclosure.assumptions} />
      ) : null}

      <View accessible style={styles.provenance}>
        <Text style={styles.metadata}>{disclosure.packet}</Text>
        <Text style={styles.metadata}>{disclosure.sources}</Text>
        <Text style={styles.metadata}>{disclosure.verifier}</Text>
        {disclosure.stale ? (
          <Text accessibilityRole="alert" style={styles.errorText}>
            Stale version — cannot confirm
          </Text>
        ) : null}
      </View>

      {props.item.checks.map((check) => (
        <View key={check.checkId} style={styles.check}>
          <Text style={styles.checkLabel}>
            {check.severity === "blocking"
              ? "Required check"
              : "Advisory check"}
            {` · ${check.state}`}
          </Text>
          <Text style={styles.body}>{check.explanation}</Text>
        </View>
      ))}

      <View style={styles.actionRow}>
        {actions.map((action) => (
          <ReviewButton
            key={action.id}
            action={action}
            onPress={handlers[action.id]}
            primary={action.id === "accept"}
          />
        ))}
      </View>
    </View>
  );
}

function Field(props: Readonly<{ label: string; value: string }>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <Text style={styles.body}>{props.value}</Text>
    </View>
  );
}

function List(props: Readonly<{ label: string; values: readonly string[] }>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      {props.values.map((value) => (
        <Text key={value} style={styles.body}>{`• ${value}`}</Text>
      ))}
    </View>
  );
}

function ReviewButton(
  props: Readonly<{
    action: ReviewAction;
    onPress: () => void;
    primary: boolean;
  }>,
) {
  return (
    <Pressable
      accessibilityHint={props.action.accessibilityHint}
      accessibilityRole="button"
      accessibilityState={{ disabled: !props.action.enabled }}
      disabled={!props.action.enabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.action,
        props.primary ? styles.primary : styles.secondary,
        pressed && styles.pressed,
        !props.action.enabled && styles.disabled,
      ]}
    >
      <Text style={props.primary ? styles.primaryText : styles.secondaryText}>
        {props.action.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    borderRadius: theme.radius.large,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: theme.target.minimum,
    minWidth: 144,
    padding: theme.space[3],
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.space[3],
  },
  body: { color: theme.color.ink, fontSize: 16, lineHeight: 25 },
  buildingLabel: {
    backgroundColor: theme.color.buildingContainer,
    borderRadius: theme.radius.small,
    color: theme.color.building,
    fontSize: 14,
    fontWeight: "700",
    padding: theme.space[2],
  },
  card: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.outline,
    borderRadius: theme.radius.medium,
    borderWidth: 1,
    gap: theme.space[4],
    padding: theme.space[4],
  },
  check: {
    backgroundColor: theme.color.limitationContainer,
    borderRadius: theme.radius.medium,
    gap: theme.space[1],
    padding: theme.space[3],
  },
  checkLabel: {
    color: theme.color.limitation,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 21,
  },
  disabled: { opacity: 0.5 },
  errorText: {
    color: theme.color.major,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 25,
  },
  field: { gap: theme.space[1] },
  fieldLabel: {
    color: theme.color.inkMuted,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 21,
  },
  heading: {
    color: theme.color.ink,
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 26,
  },
  labelRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.space[2] },
  metadata: { color: theme.color.inkMuted, fontSize: 14, lineHeight: 21 },
  pestLabel: {
    backgroundColor: theme.color.timberPestContainer,
    borderRadius: theme.radius.small,
    color: theme.color.timberPest,
    fontSize: 14,
    fontWeight: "700",
    padding: theme.space[2],
  },
  pressed: { backgroundColor: theme.color.canvas },
  primary: { backgroundColor: theme.color.action },
  primaryText: {
    color: theme.color.surface,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  provenance: {
    backgroundColor: theme.color.canvas,
    borderRadius: theme.radius.medium,
    gap: theme.space[1],
    padding: theme.space[3],
  },
  reviewLabel: {
    alignSelf: "center",
    color: theme.color.inkMuted,
    fontSize: 14,
    fontWeight: "700",
  },
  secondary: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.outline,
    borderWidth: 1,
  },
  secondaryText: {
    color: theme.color.ink,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
});
