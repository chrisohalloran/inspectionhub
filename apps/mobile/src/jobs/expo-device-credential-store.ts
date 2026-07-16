import * as SecureStore from "expo-secure-store";

import { createDeviceCredentialStore } from "./device-credential-store";

const secureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  keychainService: "inspectionhub-field-device",
  requireAuthentication: false,
} as const;

export const deviceCredentialStore = createDeviceCredentialStore({
  deleteValue: (key) => SecureStore.deleteItemAsync(key, secureStoreOptions),
  getValue: (key) => SecureStore.getItemAsync(key, secureStoreOptions),
  setValue: (key, value) =>
    SecureStore.setItemAsync(key, value, secureStoreOptions),
});
