import {
  DeterministicObservedProvider,
  type ObservedFakeMode,
  type ObservedProviderResult,
} from "../observed-provider.js";

export type CalendarWindow = Readonly<{
  endsAt: string;
  inspectorId: string;
  startsAt: string;
}>;

export type CalendarReservation = CalendarWindow &
  Readonly<{
    bookingId: string;
    idempotencyKey: string;
  }>;

export interface GoogleCalendarAdapter {
  freeBusy(window: CalendarWindow): Promise<readonly CalendarWindow[]>;
  reserve(
    request: CalendarReservation,
  ): Promise<ObservedProviderResult<{ eventId: string }>>;
  cancel(request: {
    bookingId: string;
    eventId: string;
    idempotencyKey: string;
  }): Promise<ObservedProviderResult<{ cancelled: true }>>;
}

export class GoogleCalendarTestAdapter implements GoogleCalendarAdapter {
  readonly #busy: CalendarWindow[];
  readonly #reservations: DeterministicObservedProvider<
    CalendarReservation,
    { eventId: string }
  >;
  readonly #cancellations: DeterministicObservedProvider<
    { bookingId: string; eventId: string; idempotencyKey: string },
    { cancelled: true }
  >;

  constructor(
    options: {
      busy?: CalendarWindow[];
      mode?: ObservedFakeMode;
    } = {},
  ) {
    this.#busy = [...(options.busy ?? [])];
    this.#reservations = new DeterministicObservedProvider({
      mode: options.mode ?? "accepted",
      handler: (request) => ({ eventId: `calendar_test_${request.bookingId}` }),
    });
    this.#cancellations = new DeterministicObservedProvider({
      mode: options.mode ?? "accepted",
      handler: () => ({ cancelled: true as const }),
    });
  }

  async freeBusy(window: CalendarWindow): Promise<readonly CalendarWindow[]> {
    await Promise.resolve();
    return this.#busy.filter(
      (candidate) =>
        candidate.inspectorId === window.inspectorId &&
        candidate.startsAt < window.endsAt &&
        window.startsAt < candidate.endsAt,
    );
  }

  async reserve(request: CalendarReservation) {
    const conflicts = await this.freeBusy(request);
    if (conflicts.length > 0) {
      return {
        state: "failed" as const,
        code: "calendar_conflict",
        retryable: false,
        replayed: false,
      };
    }
    return this.#reservations.execute({
      operation: "calendar.reserve",
      idempotencyKey: request.idempotencyKey,
      requestFingerprint: fingerprint(request),
      payload: request,
    });
  }

  cancel(request: {
    bookingId: string;
    eventId: string;
    idempotencyKey: string;
  }) {
    return this.#cancellations.execute({
      operation: "calendar.cancel",
      idempotencyKey: request.idempotencyKey,
      requestFingerprint: fingerprint(request),
      payload: request,
    });
  }
}

function fingerprint(value: object): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
}
