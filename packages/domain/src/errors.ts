export class DomainConflictError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: string,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "DomainConflictError";
    this.code = code;
    this.details = details;
  }
}

export class EventIntegrityError extends Error {
  readonly eventIndex: number;

  constructor(message: string, eventIndex: number) {
    super(message);
    this.name = "EventIntegrityError";
    this.eventIndex = eventIndex;
  }
}
