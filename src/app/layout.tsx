import type { Metadata, Viewport } from "next";
import { Inter, EB_Garamond, JetBrains_Mono } from "next/font/google";
import "@/styles/setsuna.css";
import "@/styles/refresh.css";
import "@/styles/terminal.css";
import "@/styles/spot.css";
import "@/styles/typography.css";
import "@/styles/portfolio.css";
import "@/styles/earn-vaults.css";
import "@/styles/bucket-theme.css";
import "@/styles/logos.css";
import "@/styles/motion.css";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { WalletProvider } from "@/components/setsuna/WalletProvider";
import Toaster from "@/components/setsuna/Toaster";
import PrivyRoot from "@/components/setsuna/PrivyRoot";
import { OG_IMAGE, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/setsuna/seo";

const display = EB_Garamond({
  subsets: ["latin"],
  variable: "--f-editorial",
  display: "swap",
});
const sans = Inter({
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
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME} · Put your assets in motion`, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "Setsuna",
    "Monad",
    "Monad yield",
    "Monad DeFi",
    "MON yield vault",
    "USDC yield vault",
    "setsMON",
    "setsUSDC",
    "yield aggregator",
    "lending vault",
    "Aave",
    "Morpho",
    "Euler",
    "Neverland",
    "Curvance",
    "Kuru",
    "Perpl",
  ],
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: "finance",
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 },
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
    url: "/",
    title: `${SITE_NAME} · Put your assets in motion`,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} · Put your assets in motion`,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE],
  },
  icons: { icon: "/favicon.svg" },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  themeColor: "#080a0f",
  colorScheme: "dark",
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
        <PrivyRoot>
          <WalletProvider>
            <a className="s-skip" href="#main">
              Skip to content
            </a>
            <SiteHeader />
            {children}
            <SiteFooter />
            <Toaster />
          </WalletProvider>
        </PrivyRoot>
      </body>
    </html>
  );
}
