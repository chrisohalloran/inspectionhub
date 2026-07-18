import { theme } from "@inspection/theme/tokens";
import { useState } from "react";
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
  onReturnToCapture: () => void;
  onResolveCheck: (checkId: string) => void;
}>;

export function InvestigationReviewCard(props: InvestigationReviewCardProps) {
  const disclosure = reviewDisclosure(props.item);
  const actions = reviewActions(props.item);
  const content = props.item.finding.content;
  const [professionalDetailsOpen, setProfessionalDetailsOpen] = useState(false);
  const [provenanceOpen, setProvenanceOpen] = useState(false);
  const visibleActions = actions.filter((action) => action.enabled);
  const handlers: Record<ReviewAction["id"], () => void> = {
    accept: props.onAccept,
    edit: props.onEdit,
    reject: props.onReject,
    reverify: props.onReverify,
    continue_human: props.onContinueHuman,
    return_to_capture: props.onReturnToCapture,
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
            ? props.item.status === "awaiting_decision"
              ? "AI suggestion — review required"
              : `AI suggestion — ${status}`
            : "Inspector authored"}
        </Text>
      </View>

      <Text style={styles.heading}>{props.item.finding.content.location}</Text>
      {props.item.status !== "awaiting_decision" ? (
        <Text
          accessibilityRole={props.item.status === "stale" ? "alert" : "text"}
          style={
            props.item.status === "stale"
              ? styles.staleStatus
              : styles.decisionStatus
          }
        >
          {props.item.status === "accepted"
            ? "Finding accepted"
            : props.item.status === "rejected"
              ? "Suggestion rejected"
              : "Finding version stale — replace it before approval"}
        </Text>
      ) : null}
      <Field
        label="Observation"
        value={props.item.finding.content.observation}
      />
      <Field
        label={props.item.module === "building" ? "Classification" : "Category"}
        value={
          content.module === "building"
            ? content.classification.replaceAll("_", " ")
            : content.category.replaceAll("_", " ")
        }
      />
      <Field
        label="Qualified opinion"
        value={props.item.finding.content.qualifiedOpinion}
      />
      <Field
        label="Apparent extent"
        value={props.item.finding.content.apparentExtent}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: professionalDetailsOpen }}
        onPress={() => setProfessionalDetailsOpen((current) => !current)}
        style={({ pressed }) => [
          styles.detailToggle,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.detailToggleText}>
          {professionalDetailsOpen
            ? "Hide professional details"
            : "Professional details"}
        </Text>
      </Pressable>
      {professionalDetailsOpen ? (
        <View accessible style={styles.provenance}>
          {disclosure.uncertainty.length > 0 ? (
            <List label="Uncertainty" values={disclosure.uncertainty} />
          ) : null}
          {disclosure.assumptions.length > 0 ? (
            <List
              label="Assumptions to confirm"
              values={disclosure.assumptions}
            />
          ) : null}
          <Field
            label="Further inspection"
            value={
              props.item.finding.content.furtherInvestigation ??
              "No further inspection identified"
            }
          />
        </View>
      ) : null}

      <Text style={styles.metadata}>{disclosure.sources}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: provenanceOpen }}
        onPress={() => setProvenanceOpen((current) => !current)}
        style={({ pressed }) => [
          styles.detailToggle,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.detailToggleText}>
          {provenanceOpen
            ? "Hide source and verification details"
            : "Source and verification details"}
        </Text>
      </Pressable>
      {provenanceOpen ? (
        <View accessible style={styles.provenance}>
          <Text style={styles.metadata}>{disclosure.packet}</Text>
          <Text style={styles.metadata}>{disclosure.verifier}</Text>
          {disclosure.stale ? (
            <Text accessibilityRole="alert" style={styles.errorText}>
              Stale version — cannot confirm
            </Text>
          ) : null}
        </View>
      ) : null}

      {props.item.checks.map((check) => (
        <View key={check.checkId} style={styles.check}>
          <Text style={styles.checkLabel}>
            {check.severity === "blocking"
              ? `Required check · ${check.state}`
              : "Inspector prompt"}
          </Text>
          <Text style={styles.body}>{check.explanation}</Text>
          {check.severity === "blocking" && check.state === "open" ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => props.onResolveCheck(check.checkId)}
              style={({ pressed }) => [
                styles.checkAction,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.checkActionText}>Resolve this check</Text>
            </Pressable>
          ) : null}
        </View>
      ))}

      <View style={styles.actionRow}>
        {visibleActions.map((action) => (
          <ReviewButton
            key={action.id}
            action={action}
            onPress={handlers[action.id]}
            primary={
              action.id === "accept" || action.id === "return_to_capture"
            }
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
  checkAction: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: theme.color.surface,
    borderColor: theme.color.outline,
    borderRadius: theme.radius.large,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: theme.target.minimum,
    paddingHorizontal: theme.space[3],
  },
  checkActionText: {
    ...theme.typography.labelLg,
    color: theme.color.ink,
  },
  disabled: { opacity: 0.5 },
  decisionStatus: {
    alignSelf: "flex-start",
    backgroundColor: theme.color.minorContainer,
    borderRadius: theme.radius.small,
    color: theme.color.minor,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 21,
    paddingHorizontal: theme.space[2],
    paddingVertical: theme.space[1],
  },
  detailToggle: {
    alignItems: "center",
    backgroundColor: theme.color.surface,
    borderColor: theme.color.outline,
    borderRadius: theme.radius.large,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: theme.target.minimum,
    padding: theme.space[3],
  },
  detailToggleText: {
    ...theme.typography.labelLg,
    color: theme.color.action,
    textAlign: "center",
  },
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
  pressed: { opacity: 0.78 },
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
    gap: theme.space[3],
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
  staleStatus: {
    alignSelf: "flex-start",
    backgroundColor: theme.color.majorContainer,
    borderRadius: theme.radius.small,
    color: theme.color.major,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 21,
    paddingHorizontal: theme.space[2],
    paddingVertical: theme.space[1],
  },
});
