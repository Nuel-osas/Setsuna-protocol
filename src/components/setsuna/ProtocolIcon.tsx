import Image from "next/image";
import { protocolLogo } from "@/lib/setsuna/logos";

export default function ProtocolIcon({
  name,
  size = 24,
}: {
  name: string;
  size?: number;
}) {
  const src = protocolLogo(name);
  if (src)
    return (
      <Image
        src={src}
        alt=""
        aria-hidden="true"
        className="s-protocol-icon"
        data-protocol={name}
        width={size}
        height={size}
        style={{ objectFit: "contain", flexShrink: 0 }}
      />
    );

  // Only cash gets the wallet icon; unknown protocols must not masquerade as cash.
  if (name !== "Cash buffer" && name !== "Held as cash") return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 8V6a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v10H6a3 3 0 0 1-3-3V7" />
      <path d="M20 13h-4a2 2 0 0 0 0 4h4" />
      <path d="M16 15h.01" />
    </svg>
  );
}

export function ProtocolLabel({
  name,
  size = 20,
}: {
  name: string;
  size?: number;
}) {
  return (
    <span className="s-protocol-label">
      <ProtocolIcon name={name} size={size} />
      <span>{name}</span>
    </span>
  );
}
