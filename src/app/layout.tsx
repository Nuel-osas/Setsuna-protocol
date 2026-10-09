import type { Metadata, Viewport } from "next";
import { Instrument_Sans, EB_Garamond, JetBrains_Mono } from "next/font/google";
import "@/styles/setsuna.css";
import "@/styles/refresh.css";
import "@/styles/terminal.css";
import "@/styles/spot.css";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { WalletProvider } from "@/components/setsuna/WalletProvider";

const display = EB_Garamond({
  subsets: ["latin"],
  variable: "--f-editorial",
  display: "swap",
});
const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--f-sans",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--f-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Setsuna · Put your assets in motion",
  description:
    "Automated MON and USDC yield vaults on Monad, with transparent allocation rules. Earn, swap and trade from one place.",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#061416",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
    >
      <body>
        <WalletProvider>
          <a className="s-skip" href="#main">
            Skip to content
          </a>
          <SiteHeader />
          {children}
          <SiteFooter />
        </WalletProvider>
      </body>
    </html>
  );
}
