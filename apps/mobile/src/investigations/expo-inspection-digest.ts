import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";

import type { LocalInspectionDigestPort } from "./local-inspection-repository";

export const expoInspectionDigest: LocalInspectionDigestPort = {
  sha256(value) {
    return digestStringAsync(CryptoDigestAlgorithm.SHA256, value);
  },
};
