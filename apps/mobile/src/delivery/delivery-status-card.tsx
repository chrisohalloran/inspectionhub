import { theme } from "@inspection/theme/tokens";
import { StyleSheet, Text, View } from "react-native";

import type { FieldDeliveryStatus } from "./delivery-status";

export function DeliveryStatusCard(
  props: Readonly<{
    status: FieldDeliveryStatus;
  }>,
) {
  return (
    <View
      accessibilityLabel={`${props.status.heading}. ${props.status.detail}`}
      accessibilityLiveRegion="polite"
      style={styles.card}
    >
      <Text style={styles.heading}>{props.status.heading}</Text>
      <Text style={styles.detail}>{props.status.detail}</Text>
      {props.status.interventionRequired ? (
        <Text accessibilityRole="alert" style={styles.alert}>
          Intervention required
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  alert: {
    color: theme.color.major,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 25,
  },
  card: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.outline,
    borderRadius: theme.radius.medium,
    borderWidth: 1,
    gap: theme.space[2],
    padding: theme.space[4],
  },
  detail: { color: theme.color.inkMuted, fontSize: 16, lineHeight: 25 },
  heading: {
    color: theme.color.ink,
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 26,
  },
});
