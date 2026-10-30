"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type Chain, ECOSYSTEM_LABEL } from "@/lib/chains";

export function ChainIcon({ c, size = 28 }: { c: Chain; size?: number }) {
  return c.icon ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="cicon" src={c.icon} alt="" width={size} height={size} />
  ) : (
    <span className="glyph" style={{ ["--h" as string]: c.hue, width: size, height: size }}>{c.short.slice(0, 3)}</span>
  );
}

export function ChainPicker({ label, value, other, chains, onChange, balance, costs, onOpen }: {
  label: string; value: Chain; other: Chain; chains: Chain[]; onChange: (c: Chain) => void; balance?: string;
  /** Per-family delivery cost labels, shown in the menu (destination picker). */
  costs?: Record<string, string>; onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const list = useMemo(() => chains.filter((c) => `${c.name} ${c.ecosystem} ${c.domain}`.toLowerCase().includes(q.toLowerCase())), [chains, q]);

  return (
    <div ref={ref} className="picker">
      <button type="button" className="chain-pick" onClick={() => { if (!open) onOpen?.(); setOpen(!open); setQ(""); }} aria-expanded={open}>
        <label>{label}</label>
        <span className="val">
          <ChainIcon c={value} />
          <span className="val-name">{value.name}<small>{ECOSYSTEM_LABEL[value.ecosystem]}</small></span>
          <span className="caret">▾</span>
        </span>
        {balance && <span className="bal">{balance}</span>}
      </button>
      {open && (
        <div className="menu" role="listbox">
          <input autoFocus className="menu-search" placeholder={`Search ${chains.length} chains`} value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="menu-list">
            {list.map((c) => (
              <button key={c.id} type="button" disabled={!c.bridgeable} onClick={() => { onChange(c); setOpen(false); }}>
                <ChainIcon c={c} size={24} />
                <span className="menu-name">{c.name}<small>{ECOSYSTEM_LABEL[c.ecosystem]} · {costs?.[c.family] ? costs[c.family] : `domain ${c.domain}`}</small></span>
                <span className={`tag ${c.bridgeable ? "" : "soon"}`}>{!c.bridgeable ? "SOON" : c.family === other.family ? "⇅ SWAP" : c.family === value.family ? "SELECTED" : c.fast ? "FAST" : "NATIVE"}</span>
              </button>
            ))}
            {list.length === 0 && <div className="menu-empty">No chain matches “{q}”</div>}
          </div>
        </div>
      )}
    </div>
  );
}
