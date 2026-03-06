import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "X Momentum — Post Analytics",
  description: "Dashboard for X automation posting results and analytics",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
