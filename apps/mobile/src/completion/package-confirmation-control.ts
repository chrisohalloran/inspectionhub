export function packageConfirmationControl(input: {
  readonly busy: boolean;
  readonly canConfirmPackage: boolean;
  readonly packageConfirmed: boolean;
}): Readonly<{ disabled: boolean; label: string }> {
  return {
    disabled: input.busy || input.packageConfirmed || !input.canConfirmPackage,
    label: input.packageConfirmed
      ? "Delivery package confirmed"
      : "Confirm delivery package",
  };
}
