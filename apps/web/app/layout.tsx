import "@fontsource-variable/inter";
import "@inspection/theme/tokens.css";
import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "InspectionHub",
  description: "Building and Timber Pest inspection workflow and reports.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
