import type { Metadata } from "next";
import { Geist_Pixel, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--f-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--f-mono", display: "swap" });
const pixel = Geist_Pixel({ subsets: ["latin"], weight: "variable", axes: ["ELSH"], variable: "--f-pixel", display: "swap" });

export const metadata: Metadata = {
  title: "Setsuna Bridge · USDC in seconds",
  description: "Native USDC across chains with Circle CCTP V2. Burn, attest, mint: no wrapped tokens, no pools.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${mono.variable} ${pixel.variable}`}>{children}</body>
    </html>
  );
}
