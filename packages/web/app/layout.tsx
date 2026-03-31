import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClawScale",
  description: "Multi-tenant OpenClaw workspace",
  icons: { icon: "/logo.png" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
