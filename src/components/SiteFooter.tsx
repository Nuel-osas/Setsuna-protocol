"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Brand from "@/components/setsuna/Brand";

const cols = [
  [
    "Explore",
    [
      ["/earn/", "Earn vaults"],
      ["/app/?tab=spot", "Spot"],
      ["/app/?tab=perps", "Perps"],
      ["/portfolio/", "Portfolio"],
      ["/app/", "Open app"],
    ],
  ],
  [
    "Resources",
    [
      ["/earn/#rates", "Live rates"],
      ["/docs/", "Documentation"],
      ["/faq/", "FAQ"],
    ],
  ],
  [
    "Legal",
    [
      ["/privacy-policy/", "Privacy"],
      ["/terms-of-use/", "Preview terms"],
    ],
  ],
] as const;

export default function SiteFooter() {
  const path = usePathname();
  if (
    path.startsWith("/app") ||
    path.startsWith("/portfolio") ||
    path === "/docs" ||
    path.startsWith("/docs/")
  )
    return null;
  return (
    <footer className="s-footer">
      <div className="s-footer-grid">
        <div>
          <Brand />
          <p>
            A calmer way to put your assets to work. Automated Earn vaults, Spot
            and Perps on Monad.
          </p>
        </div>
        {cols.map(([title, links]) => (
          <nav key={title} aria-label={title}>
            <h4>{title}</h4>
            {links.map(([href, label]) => (
              <Link key={href} href={href}>
                {label}
              </Link>
            ))}
          </nav>
        ))}
      </div>
      <div className="s-footer-base">
        <span>© 2026 Setsuna · Built on Monad</span>
        <span>
          Development preview. Public deposits and trading are closed.
        </span>
      </div>
      <div className="m-footer-word" aria-hidden="true">
        setsuna
      </div>
    </footer>
  );
}
