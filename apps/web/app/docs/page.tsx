/**
 * `/docs` landing page.
 *
 * Hero + table-of-contents grid + quick links. The grid groups doc
 * pages by section; "Overview" is rendered as a single hero band
 * rather than a duplicate card. Section copy (the descriptive text
 * under each heading) is hand-written here rather than pulled from
 * markdown so the landing page reads like a curated index, not a
 * dump of titles.
 *
 * Server component — zero JavaScript ships to the client.
 *
 * LLM-agnostic: the landing copy never names a provider.
 */

import { DocsLanding } from '@/components/docs/landing';
import {
  DOC_SECTIONS,
  type DocPage,
  type DocSectionKey,
  STATIC_DOC_PAGES,
} from '@/lib/docs/registry';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ALDO AI Documentation',
  description:
    'Quickstart, concepts, guides, API reference, and SDKs for the ALDO AI control plane.',
  openGraph: {
    title: 'ALDO AI Documentation',
    description: 'Quickstart, concepts, guides, API reference, and SDKs.',
    type: 'website',
    url: '/docs',
    images: [{ url: '/docs/og.svg', alt: 'ALDO AI Documentation' }],
  },
};

const SECTION_DESCRIPTIONS: Partial<Record<DocSectionKey, string>> = {
  concepts: 'Mental models that shape every part of the platform.',
  guides: 'Task-oriented walkthroughs — from "I want to build an agent" to "I want to self-host".',
  api: 'Auto-generated reference for every endpoint that has a Zod schema.',
  sdks: 'TypeScript and Python clients for the control plane.',
  reference: 'Changelog, license, and other reference material.',
};

export default function DocsLandingPage() {
  // Group static pages by section, dropping the implicit `/docs` row
  // (it's the page we're rendering) and the `Overview` section header
  // (rendered as the hero).
  const grouped = new Map<DocSectionKey, DocPage[]>();
  for (const section of DOC_SECTIONS) grouped.set(section.key, []);
  for (const page of STATIC_DOC_PAGES) {
    if (page.slug === '') continue;
    if (page.section === 'overview') continue;
    const arr = grouped.get(page.section);
    if (arr) arr.push(page);
  }
  const sections = DOC_SECTIONS.filter((s) => !s.root && (grouped.get(s.key)?.length ?? 0) > 0).map(
    (s) => ({
      key: s.key,
      label: s.label,
      description: SECTION_DESCRIPTIONS[s.key] ?? '',
      pages: grouped.get(s.key) ?? [],
    }),
  );

  // Single quickstart-pointer page used as the hero CTA.
  const quickstart = STATIC_DOC_PAGES.find((p) => p.slug === 'quickstart');

  return (
    <DocsLanding
      sections={sections}
      quickstart={
        quickstart
          ? { title: quickstart.title, summary: quickstart.summary, slug: quickstart.slug }
          : null
      }
    />
  );
}
