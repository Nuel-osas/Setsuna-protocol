"use client";
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
    </footer>
  );
}
