"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import FooterRebound from "@/components/setsuna/FooterRebound";

export default function SiteFooter() {
  const path = usePathname();
  if (
    path.startsWith("/app") ||
    path.startsWith("/trade") ||
    path.startsWith("/portfolio") ||
    path.startsWith("/earn") ||
    path === "/docs" ||
    path.startsWith("/docs/")
  )
    return null;
  // The home page ends on its pixel wall: no legal strip, just the pull underneath.
  if (path === "/") return <FooterRebound key={path} variant="pixel" />;
  return (
    <>
      <footer className="s-footer">
        <div className="m-footer-legal">
          <span>© 2026 Setsuna · Built on Monad</span>
          <nav aria-label="Legal">
            <Link href="/privacy-policy/">Privacy</Link>
            <Link href="/terms-of-use/">Terms</Link>
          </nav>
          <span>Live on mainnet · Capped beta · Not audited</span>
        </div>
      </footer>
      {/* Keyed by route so the pull area re-measures on each page. */}
      <FooterRebound key={path} />
    </>
  );
}
