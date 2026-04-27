'use client';

/**
 * Tabbed shell for /agents/[name] (wave-12 redesign).
 *
 * Five tabs: Spec | Safety | Composite | Eval | Runs. Tabs are
 * client-side via Radix; each panel takes pre-rendered server content
 * (so the heavy lifting stays in RSC). The eval panel is the
 * exception — it pulls live data through `<EvalAnalytics>` because the
 * Recharts components must run on the client anyway.
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ReactNode } from 'react';

export interface AgentDetailTabsProps {
  spec: ReactNode;
  safety: ReactNode;
  composite: ReactNode;
  evalView: ReactNode;
  runs: ReactNode;
}

export function AgentDetailTabs({ spec, safety, composite, evalView, runs }: AgentDetailTabsProps) {
  return (
    <Tabs defaultValue="spec" className="w-full">
      <TabsList>
        <TabsTrigger value="spec">Spec</TabsTrigger>
        <TabsTrigger value="safety">Safety</TabsTrigger>
        <TabsTrigger value="composite">Composite</TabsTrigger>
        <TabsTrigger value="eval">Eval</TabsTrigger>
        <TabsTrigger value="runs">Runs</TabsTrigger>
      </TabsList>
      <TabsContent value="spec">{spec}</TabsContent>
      <TabsContent value="safety">{safety}</TabsContent>
      <TabsContent value="composite">{composite}</TabsContent>
      <TabsContent value="eval">{evalView}</TabsContent>
      <TabsContent value="runs">{runs}</TabsContent>
    </Tabs>
  );
}
