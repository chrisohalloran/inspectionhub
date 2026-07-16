export type DeviceCredential = {
  deviceId: string;
  enrollmentSecret: string;
};

export interface SecureValuePort {
  deleteValue(key: string): Promise<void>;
  getValue(key: string): Promise<string | null>;
  setValue(key: string, value: string): Promise<void>;
}

const credentialKey = "inspectionhub.field.device-credential.v1";

export function createDeviceCredentialStore(port: SecureValuePort) {
  return {
    load: async (): Promise<DeviceCredential | undefined> => {
      const value = await port.getValue(credentialKey);
      if (value === null) return undefined;
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed !== "object" || parsed === null) {
        throw new Error("Stored device credential is invalid");
      }
      const candidate = parsed as Partial<DeviceCredential>;
      if (
        typeof candidate.deviceId !== "string" ||
        candidate.deviceId.length === 0 ||
        typeof candidate.enrollmentSecret !== "string" ||
        candidate.enrollmentSecret.length === 0
      ) {
        throw new Error("Stored device credential is invalid");
      }
      return {
        deviceId: candidate.deviceId,
        enrollmentSecret: candidate.enrollmentSecret,
      };
    },
    revokeLocal: () => port.deleteValue(credentialKey),
    save: (credential: DeviceCredential) =>
      port.setValue(credentialKey, JSON.stringify(credential)),
  };
}
