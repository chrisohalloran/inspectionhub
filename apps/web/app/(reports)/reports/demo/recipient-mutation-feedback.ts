type RecipientMutationKind = "invitation" | "question";

type RecipientMutationErrorBody = Readonly<{
  error?: unknown;
}>;

export async function recipientMutationFailureMessage(
  response: Pick<Response, "headers" | "json" | "status">,
  kind: RecipientMutationKind,
): Promise<string | null> {
  const reason = await errorReason(response);
  if (response.status === 409 && reason === "grant_mutation_limit_reached") {
    return kind === "invitation"
      ? "This access has reached its lifetime invitation limit. No more invitations can be recorded from this access."
      : "This access has reached its lifetime question limit. No more questions can be recorded from this access.";
  }
  if (response.status !== 429) return null;

  const retryAfterSeconds = parseRetryAfter(
    response.headers.get("retry-after"),
  );
  const subject = kind === "invitation" ? "Invitation" : "Question";
  return retryAfterSeconds === null
    ? `${subject} requests are temporarily limited. Try again later.`
    : `${subject} requests are temporarily limited. Try again in ${duration(retryAfterSeconds)}.`;
}

async function errorReason(response: Pick<Response, "json">): Promise<unknown> {
  try {
    const body = (await response.json()) as RecipientMutationErrorBody;
    return typeof body === "object" && body !== null ? body.error : undefined;
  } catch {
    return undefined;
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (/^\d+$/u.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null;
  }
  const retryAt = Date.parse(trimmed);
  if (!Number.isFinite(retryAt) || retryAt <= Date.now()) return null;
  return Math.max(1, Math.ceil((retryAt - Date.now()) / 1_000));
}

function duration(seconds: number): string {
  if (seconds < 60) return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) {
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  const hours = Math.ceil(minutes / 60);
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}
