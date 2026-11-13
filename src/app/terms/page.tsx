import type { Metadata } from "next";

export const metadata: Metadata = { title: 'Terms of Use' };

export default function Page() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Terms of Use</h1>
      <div className="mt-6 space-y-4">
        <p className="text-[15px] leading-relaxed text-muted">{'Ryven is a hackathon prototype running on Solana devnet. Devnet tokens have no monetary value.'}</p>
        <p className="text-[15px] leading-relaxed text-muted">{'Do not use Ryven with real funds. The bonding-curve program included in the source is unaudited.'}</p>
        <p className="text-[15px] leading-relaxed text-muted">{'You are responsible for the instructions you give your agent and for the wallets you approve as recipients. Every on-chain transaction is public and irreversible.'}</p>
        <p className="text-[15px] leading-relaxed text-muted">{'The software is provided "as is", without warranty of any kind.'}</p>
      </div>
    </div>
  );
}
