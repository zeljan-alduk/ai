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

export type RunDetailTab = 'timeline' | 'events' | 'tree' | 'composition' | 'replay';

export function RunDetailTabs({
  defaultTab = 'timeline',
  timeline,
  events,
  tree,
  composition,
  replay,
}: {
  defaultTab?: RunDetailTab;
  timeline: ReactNode;
  events: ReactNode;
  tree: ReactNode;
  /**
   * Spec-level transition graph for the run's agent — renders the
   * sequential / parallel / debate / iterative supervisor structure
   * via <CompositeDiagram>. `null` for leaf agents (no graph to
   * render); the page filters those out and skips the tab when it
   * would be empty.
   */
  composition: ReactNode;
  replay: ReactNode;
}) {
  const showComposition = composition !== null;
  return (
    <Tabs defaultValue={defaultTab}>
      <TabsList>
        <TabsTrigger value="timeline">Timeline</TabsTrigger>
        <TabsTrigger value="events">Events</TabsTrigger>
        <TabsTrigger value="tree">Tree</TabsTrigger>
        {showComposition ? <TabsTrigger value="composition">Composition</TabsTrigger> : null}
        <TabsTrigger value="replay">Replay</TabsTrigger>
      </TabsList>
      <TabsContent value="timeline">{timeline}</TabsContent>
      <TabsContent value="events">{events}</TabsContent>
      <TabsContent value="tree">{tree}</TabsContent>
      {showComposition ? <TabsContent value="composition">{composition}</TabsContent> : null}
      <TabsContent value="replay">{replay}</TabsContent>
    </Tabs>
  );
}
