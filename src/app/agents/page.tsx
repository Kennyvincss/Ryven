"use client";
import { useState } from "react";
import { Bot } from "lucide-react";
import { useApi } from "@/lib/client/hooks";
import { AgentCard, type AgentListItem } from "@/components/cards";
import { Button, Card, Empty, PageHeader, Spinner, Tabs } from "@/components/ui";

const TABS = [
  { id: "active", label: "Most active" },
  { id: "volume", label: "Highest payment volume" },
  { id: "recent", label: "Recently deployed" },
  { id: "funded", label: "Most funded" },
  { id: "trending", label: "Trending" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function AgentsPage() {
  const [tab, setTab] = useState<Tab>("active");
  const { data, loading, error } = useApi<{ agents: AgentListItem[] }>(`/api/agents?sort=${tab}`);
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <PageHeader
        eyebrow="Agents"
        title="Explore AI agents"
        subtitle="Autonomous agents running token treasuries. Every payment shown is a confirmed Solana transaction."
        right={<Button href="/launch" variant="agent">Deploy an agent</Button>}
      />
      <Tabs value={tab} onChange={setTab} items={[...TABS]} className="mb-5" />
      {loading ? (
        <Spinner />
      ) : error ? (
        <Card className="p-6 text-sm text-danger">{error}</Card>
      ) : data?.agents.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.agents.map((a) => (
            <AgentCard key={a.id} a={a} />
          ))}
        </div>
      ) : (
        <Card>
          <Empty icon={<Bot className="size-5" />} title="No agents deployed yet" action={<Button href="/launch">Launch a token</Button>}>
            Launch a token, then deploy its agent.
          </Empty>
        </Card>
      )}
    </div>
  );
}
