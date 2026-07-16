export type FieldDeliveryState =
  | "waiting_for_approval"
  | "waiting_for_evidence"
  | "queued"
  | "sending"
  | "provider_accepted"
  | "sent"
  | "failed"
  | "unknown"
  | "cancelled";

export type FieldDeliveryStatus = Readonly<{
  heading: string;
  detail: string;
  terminal: boolean;
  leaveSiteAllowed: boolean;
  interventionRequired: boolean;
}>;

export function fieldDeliveryStatus(
  state: FieldDeliveryState,
  interventionRequired = false,
): FieldDeliveryStatus {
  switch (state) {
    case "waiting_for_approval":
      return status(
        "Delivery not ready",
        "Each commissioned module needs its own current approval.",
        false,
        false,
        false,
      );
    case "waiting_for_evidence":
      return status(
        "Delivery queued — evidence synchronising",
        "You can leave site. Delivery will start only after required originals are checksum-confirmed as durable.",
        false,
        true,
        false,
      );
    case "queued":
      return status(
        "Delivery queued",
        "The approved package manifest is saved locally. Server enqueue confirmation remains pending.",
        false,
        true,
        false,
      );
    case "sending":
      return status(
        "Sending",
        "Provider delivery is in progress. This is not yet marked sent.",
        false,
        true,
        false,
      );
    case "provider_accepted":
      return status(
        "Provider accepted",
        "The provider accepted the request; sent confirmation is still pending.",
        false,
        true,
        false,
      );
    case "sent":
      return status(
        "Sent",
        "The provider confirmed the package was sent.",
        true,
        true,
        false,
      );
    case "failed":
      return status(
        interventionRequired
          ? "Delivery needs attention"
          : "Delivery retry queued",
        interventionRequired
          ? "The failure is terminal and requires an explicit intervention."
          : "The provider failed temporarily; the durable request can retry automatically.",
        interventionRequired,
        true,
        interventionRequired,
      );
    case "unknown":
      return status(
        "Delivery outcome unknown",
        "The provider may have accepted the request. Reconciliation is required before retrying.",
        false,
        true,
        true,
      );
    case "cancelled":
      return status(
        "Delivery cancelled",
        "No new provider send may start for this package.",
        true,
        true,
        false,
      );
  }
}

function status(
  heading: string,
  detail: string,
  terminal: boolean,
  leaveSiteAllowed: boolean,
  interventionRequired: boolean,
): FieldDeliveryStatus {
  return {
    heading,
    detail,
    terminal,
    leaveSiteAllowed,
    interventionRequired,
  };
}
