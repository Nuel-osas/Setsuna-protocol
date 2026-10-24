import type { Metadata, Viewport } from "next";
import { Inter, EB_Garamond, JetBrains_Mono, Geist_Pixel } from "next/font/google";
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
import "@/styles/app-brand.css";
import { Analytics } from "@vercel/analytics/next";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { WalletProvider } from "@/components/setsuna/WalletProvider";
import Toaster from "@/components/setsuna/Toaster";
import { mainnetDeployment } from "@/lib/setsuna/mainnet-deployment";
import EarnSeed from "@/components/setsuna/EarnSeed";
import { earnSeeds } from "@/lib/setsuna/earn-seed";
import { OG_IMAGE, SITE_DESCRIPTION, SITE_NAME, SITE_URL, X_HANDLE } from "@/lib/setsuna/seo";

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
// The landing's display face, now site-wide for page titles and figures.
const pixel = Geist_Pixel({
  subsets: ["latin"],
  weight: "variable",
  axes: ["ELSH"],
  variable: "--f-pixel",
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
    site: X_HANDLE,
    creator: X_HANDLE,
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

// Pages carry the vaults' figures in their HTML, refreshed at most every 30s.
export const revalidate = 30;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The network config is public (also served at /api/deployment); sending it
  // in the page removes a round trip before anything can load.
  const deployment = mainnetDeployment();
  const seeds = await earnSeeds(deployment);
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable} ${pixel.variable}`}
    >
      <body>
        <WalletProvider initialDeployment={deployment}>
          <EarnSeed seeds={seeds} />
            <a className="s-skip" href="#main">
              Skip to content
            </a>
            <SiteHeader />
            {children}
            <SiteFooter />
            <Toaster />
        </WalletProvider>
        <Analytics />
      </body>
    </html>
  );
}
