import type { CSSProperties, ReactNode } from "react";
import { Mark } from "@/components/setsuna/Brand";
import TokenIcon from "@/components/setsuna/TokenIcon";
import ProtocolIcon from "@/components/setsuna/ProtocolIcon";

export type Fill = "blue" | "deep" | "glass" | "paper" | "grid" | "ink";
export type Hex = {
  c: number;
  r: number;
  fill: Fill;
  logo?: string;
  token?: "MON" | "USDC";
  kind?: "apr" | "mark" | "info";
};

/** Honeycomb placement in column/row units; odd rows sit half a cell to the right. */
export function hexStyle(h: Hex, w: string): CSSProperties {
  return {
    "--x": `calc(${h.c + (h.r % 2) * 0.5} * ${w})`,
    "--y": `calc(${h.r * 0.75} * ${w} * 1.1547)`,
  } as CSSProperties;
}

/** One hexagon. With `back`, a second face waits below and slides up when `flipped`. */
export function HexCell({
  hex,
  children,
  back,
  flipped = false,
  className = "",
}: {
  hex: Hex;
  children?: ReactNode;
  back?: ReactNode;
  flipped?: boolean;
  className?: string;
}) {
  return (
    <div className={`lx-hex is-${hex.fill} ${flipped ? "is-flipped" : ""} ${className}`}>
      <span className="lx-hex-face">
        {hex.logo && <ProtocolIcon name={hex.logo} size={44} />}
        {hex.token && <TokenIcon asset={hex.token} size={44} />}
        {hex.kind === "mark" && <Mark size={56} color={hex.fill === "paper" ? "#2338ff" : "#f2efe8"} />}
        {children}
      </span>
      {back !== undefined && <span className="lx-hex-face is-back">{back}</span>}
    </div>
  );
}
