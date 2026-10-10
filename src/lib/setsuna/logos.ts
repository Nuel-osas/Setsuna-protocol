export const tokenLogos = {
  MON: "/images/tokens/monad.svg",
  USDC: "/images/tokens/usdc.svg",
  AUSD: "/images/tokens/ausd.svg",
  BTC: "/images/tokens/bitcoin.png",
} as const;

export type LogoToken = keyof typeof tokenLogos;

const protocolLogos = new Map([
  ["aave", "/images/protocols/aave-icon.png"],
  ["morpho", "/images/protocols/morpho.svg"],
  ["euler", "/images/protocols/euler.svg"],
  ["neverland", "/images/protocols/neverland.svg"],
  ["curvance", "/images/protocols/curvance.svg"],
  ["kuru", "/images/protocols/kuru.svg"],
  ["perpl", "/images/protocols/perpl.svg"],
]);

// Accept display labels such as "Aave V3" or "Euler · eUSDC-12".
export const protocolLogo = (label: string) =>
  protocolLogos.get(
    label
      .trim()
      .split(/[\s·'’]/)[0]
      .toLowerCase(),
  );
