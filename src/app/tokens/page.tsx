"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Coins } from "lucide-react";
import { useApi } from "@/lib/client/hooks";
import { TokenCard, type TokenListItem } from "@/components/cards";
import { Button, Card, Empty, PageHeader, Spinner, Tabs } from "@/components/ui";

const TABS = [
  { id: "new", label: "New" },
  { id: "trending", label: "Trending" },
  { id: "agents", label: "With active agents" },
  { id: "agent_activity", label: "Top agent payments" },
  { id: "volume", label: "Highest volume" },
  { id: "graduated", label: "Graduated" },
] as const;
type Tab = (typeof TABS)[number]["id"];

function TokensInner() {
  const sp = useSearchParams();
  const [tab, setTab] = useState<Tab>((sp.get("tab") as Tab) ?? "new");
  const { data, loading, error } = useApi<{ tokens: TokenListItem[] }>(`/api/tokens?sort=${tab}`);
  return (
    <>
      <Tabs value={tab} onChange={setTab} items={[...TABS]} className="mb-5" />
      {(tab === "volume" || tab === "trending" || tab === "graduated") && (
        <p className="mb-4 text-xs text-faint">
          Volume, trending and graduation come from bonding-curve trades. Tokens launched with a fixed supply have no curve market and rank by
          launch time.
        </p>
      )}
      {loading ? (
        <Spinner />
      ) : error ? (
        <Card className="p-6 text-sm text-danger">{error}</Card>
      ) : data?.tokens.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.tokens.map((t) => (
            <TokenCard key={t.id} t={t} />
          ))}
        </div>
      ) : (
        <Card>
          <Empty icon={<Coins className="size-5" />} title="Nothing here yet" action={<Button href="/launch">Launch a token</Button>}>
            No tokens match this view on this deployment.
          </Empty>
        </Card>
      )}
    </>
  );
}

export default function TokensPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <PageHeader eyebrow="Launchpad" title="Explore tokens" subtitle="Every token launched on Ryven, verified on Solana before it's listed." right={<Button href="/launch">Launch a token</Button>} />
      <Suspense fallback={<Spinner />}>
        <TokensInner />
      </Suspense>
    </div>
  );
}
