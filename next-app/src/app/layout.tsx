import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tweet Momentum Exchange",
  description: "Crypto-style dashboard for postgame X automation analytics.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
