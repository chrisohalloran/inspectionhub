import { describe, expect, it } from "vitest";

import {
  createDeviceCredentialStore,
  type SecureValuePort,
} from "./device-credential-store.js";

describe("device credential store", () => {
  it("persists only the opaque enrolled-device credential and can revoke it", async () => {
    const values = new Map<string, string>();
    const port: SecureValuePort = {
      deleteValue: (key) => {
        values.delete(key);
        return Promise.resolve();
      },
      getValue: (key) => Promise.resolve(values.get(key) ?? null),
      setValue: (key, value) => {
        values.set(key, value);
        return Promise.resolve();
      },
    };
    const store = createDeviceCredentialStore(port);

    await store.save({
      deviceId: "device-field-01",
      enrollmentSecret: "opaque-device-secret",
    });
    await expect(store.load()).resolves.toEqual({
      deviceId: "device-field-01",
      enrollmentSecret: "opaque-device-secret",
    });
    await store.revokeLocal();
    await expect(store.load()).resolves.toBeUndefined();
  });

  it("fails closed on malformed secure-store data", async () => {
    const store = createDeviceCredentialStore({
      deleteValue: () => Promise.resolve(),
      getValue: () => Promise.resolve('{"deviceId":"only"}'),
      setValue: () => Promise.resolve(),
    });
    await expect(store.load()).rejects.toThrow(
      "Stored device credential is invalid",
    );
  });
});
