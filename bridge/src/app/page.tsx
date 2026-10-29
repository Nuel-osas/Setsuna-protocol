import { Bridge } from "@/components/Bridge";
import { WalletProvider } from "@/lib/wallets";

export default function Home() {
  return (
    <WalletProvider>
      <Bridge />
    </WalletProvider>
  );
}
