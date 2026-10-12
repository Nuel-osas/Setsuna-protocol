"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import WordmarkGlow from "@/components/setsuna/WordmarkGlow";

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
  return (
    <footer className="s-footer">
      <div className="m-footer-word m-bigword" aria-hidden="true">
        <WordmarkGlow />
        <span className="m-bigword-word">
          <span className="m-bigword-lit">
            <span className="m-bigword-text">setsuna</span>
          </span>
        </span>
      </div>
      <div className="m-footer-legal">
        <span>© 2026 Setsuna · Built on Monad</span>
        <nav aria-label="Legal">
          <Link href="/privacy-policy/">Privacy</Link>
          <Link href="/terms-of-use/">Terms</Link>
        </nav>
        <span>Live on mainnet · Capped beta · Not audited</span>
      </div>
    </footer>
  );
}
