export class RecipientAccessDeniedError extends Error {
  readonly code = "recipient_access_denied";

  constructor(message = "Access is unavailable for this request") {
    super(message);
    this.name = "RecipientAccessDeniedError";
  }
}

export class RecipientInputError extends Error {
  readonly code = "recipient_input_invalid";

  constructor(message: string) {
    super(message);
    this.name = "RecipientInputError";
  }
}

export class RecipientConflictError extends Error {
  readonly code = "recipient_state_conflict";

  constructor(message: string) {
    super(message);
    this.name = "RecipientConflictError";
  }
}
