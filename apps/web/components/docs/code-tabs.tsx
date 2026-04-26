'use client';

/**
 * Multi-language code tabs for docs.
 *
 * Wraps the wave-12 Tabs primitive (Radix-backed) so every API doc
 * page can show the same example in curl + Python + TypeScript with
 * a single component invocation. The MDX/markdown renderer doesn't
 * have a native tabs feature, so the API-ref pages instantiate this
 * directly inside their generated React tree.
 *
 * Each tab body is pre-rendered HTML (server-highlighted by shiki).
 * We pass it through `dangerouslySetInnerHTML` because shiki output
 * is well-formed and not user-controlled.
 *
 * LLM-agnostic: the example payloads are platform shapes, not model
 * payloads.
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export interface CodeTab {
  readonly id: string;
  readonly label: string;
  readonly html: string;
}

export interface CodeTabsProps {
  readonly tabs: ReadonlyArray<CodeTab>;
  readonly defaultId?: string;
}

export function CodeTabs({ tabs, defaultId }: CodeTabsProps) {
  if (tabs.length === 0) return null;
  const fallback = tabs[0];
  if (!fallback) return null;
  const initial = defaultId ?? fallback.id;
  return (
    <Tabs defaultValue={initial} className="not-prose my-6">
      <TabsList>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.id} value={tab.id}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.id} value={tab.id}>
          <div
            className="docs-code-block"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: pre-rendered server-side by shiki, no user-controlled input
            dangerouslySetInnerHTML={{ __html: tab.html }}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}
