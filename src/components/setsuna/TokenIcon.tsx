import Image from "next/image";
import { tokenLogos, type LogoToken } from "@/lib/setsuna/logos";

export default function TokenIcon({
  asset,
  size = 24,
}: {
  asset: LogoToken;
  size?: number;
}) {
  return (
    <Image
      src={tokenLogos[asset]}
      alt=""
      aria-hidden="true"
      data-asset={asset}
      width={size}
      height={size}
      style={{ display: "block", objectFit: "contain", flexShrink: 0 }}
    />
  );
}
