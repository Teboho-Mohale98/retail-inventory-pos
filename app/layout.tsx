import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: {
    default: "Retail Inventory & POS",
    template: "%s · Retail Inventory & POS",
  },
  description:
    "Real-time retail inventory & point-of-sale platform: article master, receiving bay with 3-way matching, POS checkout, forecasting and audit analytics.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}