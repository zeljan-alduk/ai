'use client';

/**
 * Client-island tab shell for the run-detail page.
 *
 * The page itself is a server component (it owns the data fetch); we
 * just need the interactive tab switching to live on the client. The
 * tab body content is passed as React children — server-rendered
 * markup that the client island just toggles visibility on.
 *
 * Default tab is `timeline`, which is the wave-12 centrepiece.
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui';
import type { ReactNode } from 'react';

export type RunDetailTab = 'timeline' | 'events' | 'tree' | 'replay';

export function RunDetailTabs({
  defaultTab = 'timeline',
  timeline,
  events,
  tree,
  replay,
}: {
  defaultTab?: RunDetailTab;
  timeline: ReactNode;
  events: ReactNode;
  tree: ReactNode;
  replay: ReactNode;
}) {
  return (
    <Tabs defaultValue={defaultTab}>
      <TabsList>
        <TabsTrigger value="timeline">Timeline</TabsTrigger>
        <TabsTrigger value="events">Events</TabsTrigger>
        <TabsTrigger value="tree">Tree</TabsTrigger>
        <TabsTrigger value="replay">Replay</TabsTrigger>
      </TabsList>
      <TabsContent value="timeline">{timeline}</TabsContent>
      <TabsContent value="events">{events}</TabsContent>
      <TabsContent value="tree">{tree}</TabsContent>
      <TabsContent value="replay">{replay}</TabsContent>
    </Tabs>
  );
}
