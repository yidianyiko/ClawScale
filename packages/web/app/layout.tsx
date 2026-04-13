import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Coke AI | An AI Partner That Grows With You",
  description: "Coke AI public homepage, user sign-in, registration, and personal channel setup.",
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
