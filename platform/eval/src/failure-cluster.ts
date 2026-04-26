/**
 * Wave-14 — failure-mode clustering.
 *
 * Pure-JS, no ML libs: bag-of-words + tf-idf + cosine-distance
 * agglomerative clustering. The intent is *not* to replace a real
 * embedding pipeline; it's to surface "these 12 failed cases all look
 * similar, here are the top terms" without needing an inference call.
 *
 * Algorithm (stable; deterministic given identical input):
 *   1. Tokenise each failed-output text into lowercase word tokens
 *      (alpha-numeric runs of >=2 chars), filter stopwords.
 *   2. Compute the document-frequency over the corpus + per-doc
 *      term-frequency. Vectorise as tf-idf.
 *   3. L2-normalise each vector. Cosine distance = 1 - dot-product.
 *   4. Agglomerative single-link clustering: repeatedly merge the
 *      closest pair of clusters until the closest distance exceeds
 *      `mergeThreshold` (default 0.7). Vectors are re-averaged on
 *      each merge.
 *   5. Cluster label = top-3 tf-idf terms across the cluster, joined
 *      by ` / `. Empty clusters are skipped.
 *
 * Worst case is O(n^2) over failed cases, which is fine because:
 *  - typical sweeps have <500 failed cases,
 *  - we cap at `maxCases` (default 200) and surface a "truncated" flag
 *    for the caller to handle.
 *
 * LLM-agnostic: zero model calls, zero provider names.
 */

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'has',
  'have',
  'in',
  'into',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'so',
  'such',
  'that',
  'the',
  'their',
  'them',
  'then',
  'this',
  'to',
  'was',
  'were',
  'will',
  'with',
  'i',
  'you',
  'we',
  'they',
  'he',
  'she',
  'his',
  'her',
  'our',
  'your',
  'not',
  'no',
  'do',
  'does',
  'did',
  'can',
  'could',
  'would',
  'should',
  'be',
  'been',
]);

export interface ClusterableCell {
  readonly caseId: string;
  readonly model: string;
  readonly output: string;
}

export interface FailureClusterDraft {
  readonly label: string;
  readonly count: number;
  readonly examplesSample: readonly { caseId: string; model: string; output: string }[];
  readonly topTerms: readonly string[];
}

export interface ClusterOptions {
  /** Skip merges whose distance exceeds this threshold. Default 0.7. */
  readonly mergeThreshold?: number;
  /** Cap inputs at this many cells (newest first). Default 200. */
  readonly maxCases?: number;
  /** Limit on examples-sample per cluster. Default 5. */
  readonly samplesPerCluster?: number;
}

/**
 * Cluster failed cells into similarity buckets. Always returns at
 * least one cluster per non-empty input (a single cluster of all docs
 * if nothing is similar enough to merge).
 */
export function clusterFailures(
  cells: readonly ClusterableCell[],
  opts: ClusterOptions = {},
): FailureClusterDraft[] {
  if (cells.length === 0) return [];
  const threshold = opts.mergeThreshold ?? 0.7;
  const maxCases = opts.maxCases ?? 200;
  const samples = opts.samplesPerCluster ?? 5;

  const slice = cells.slice(0, maxCases);

  // ── tokenise + per-doc term frequency ────────────────────────────
  const docTokens: string[][] = slice.map((c) => tokenize(c.output));
  // Document frequency for each token across the corpus.
  const df = new Map<string, number>();
  for (const tokens of docTokens) {
    const seen = new Set<string>();
    for (const t of tokens) {
      if (seen.has(t)) continue;
      seen.add(t);
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }
  // Build vocab from tokens with df >= 1 (every token).
  const vocab = Array.from(df.keys()).sort();
  const vocabIdx = new Map(vocab.map((t, i) => [t, i]));

  const N = slice.length;
  const idf = new Float64Array(vocab.length);
  for (let i = 0; i < vocab.length; i++) {
    const term = vocab[i] ?? '';
    const dfi = df.get(term) ?? 1;
    // Smoothed idf so single-doc terms don't dominate.
    idf[i] = Math.log((N + 1) / (dfi + 1)) + 1;
  }

  // tf-idf vectors, L2-normalised.
  const vectors: Float64Array[] = docTokens.map((tokens) => {
    const v = new Float64Array(vocab.length);
    for (const t of tokens) {
      const idx = vocabIdx.get(t);
      if (idx === undefined) continue;
      v[idx] = (v[idx] ?? 0) + 1;
    }
    for (let i = 0; i < v.length; i++) {
      v[i] = (v[i] ?? 0) * (idf[i] ?? 0);
    }
    let norm = 0;
    for (let i = 0; i < v.length; i++) {
      const x = v[i] ?? 0;
      norm += x * x;
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < v.length; i++) {
        v[i] = (v[i] ?? 0) / norm;
      }
    }
    return v;
  });

  // ── single-link agglomerative cluster ────────────────────────────
  // `clusters[i]` is the list of doc indices in cluster i; centroids[i] is
  // the running mean tf-idf vector.
  const clusters: number[][] = slice.map((_c, i) => [i]);
  const centroids: Float64Array[] = vectors.map((v) => new Float64Array(v));

  while (clusters.length > 1) {
    let bestI = -1;
    let bestJ = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const ci = centroids[i];
        const cj = centroids[j];
        if (ci === undefined || cj === undefined) continue;
        const d = cosineDistance(ci, cj);
        if (d < bestDist) {
          bestDist = d;
          bestI = i;
          bestJ = j;
        }
      }
    }
    if (bestI < 0 || bestDist > threshold) break;
    // Merge bestJ into bestI.
    const a = clusters[bestI] ?? [];
    const b = clusters[bestJ] ?? [];
    const merged = [...a, ...b];
    clusters[bestI] = merged;
    // Recompute centroid as mean of member vectors.
    const ca = centroids[bestI];
    if (ca !== undefined) {
      ca.fill(0);
      for (const idx of merged) {
        const v = vectors[idx];
        if (v === undefined) continue;
        for (let k = 0; k < ca.length; k++) {
          ca[k] = (ca[k] ?? 0) + (v[k] ?? 0);
        }
      }
      for (let k = 0; k < ca.length; k++) {
        ca[k] = (ca[k] ?? 0) / merged.length;
      }
    }
    clusters.splice(bestJ, 1);
    centroids.splice(bestJ, 1);
  }

  // ── label + examples ────────────────────────────────────────────
  const drafts: FailureClusterDraft[] = clusters.map((memberIdx) => {
    const topTerms = topTermsFor(memberIdx, vectors, vocab, 3);
    const label = topTerms.length > 0 ? topTerms.join(' / ') : 'misc';
    const examplesSample = memberIdx.slice(0, samples).map((i) => {
      const c = slice[i];
      return c
        ? {
            caseId: c.caseId,
            model: c.model,
            // Cap output to keep the row small in the DB.
            output: c.output.length > 1000 ? `${c.output.slice(0, 1000)}…` : c.output,
          }
        : { caseId: '', model: '', output: '' };
    });
    return { label, count: memberIdx.length, examplesSample, topTerms };
  });

  // Sort by descending count, then by label for stability.
  drafts.sort((a, b) =>
    b.count - a.count !== 0 ? b.count - a.count : a.label.localeCompare(b.label),
  );
  return drafts;
}

/** Tokenise: lowercase, alpha-numeric runs of >=2 chars, drop stopwords. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const lc = text.toLowerCase();
  const re = /[a-z0-9_]{2,}/g;
  let m: RegExpExecArray | null = re.exec(lc);
  while (m !== null) {
    const tok = m[0];
    if (!STOPWORDS.has(tok)) out.push(tok);
    m = re.exec(lc);
  }
  return out;
}

function cosineDistance(a: Float64Array, b: Float64Array): number {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
  }
  // Vectors are unit-norm only initially; merged centroids may not be.
  // Compute distance via 1 - cos. Cosine = dot / (|a|*|b|). For our
  // purposes a small floor on |a||b| keeps zero vectors from dividing.
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    na += (a[i] ?? 0) * (a[i] ?? 0);
    nb += (b[i] ?? 0) * (b[i] ?? 0);
  }
  na = Math.sqrt(na);
  nb = Math.sqrt(nb);
  if (na < 1e-12 || nb < 1e-12) return 1;
  const cos = dot / (na * nb);
  return 1 - cos;
}

/** Top-k terms ranked by sum of tf-idf weight across the cluster's docs. */
function topTermsFor(
  memberIdx: readonly number[],
  vectors: readonly Float64Array[],
  vocab: readonly string[],
  k: number,
): string[] {
  if (memberIdx.length === 0 || vocab.length === 0) return [];
  const sums = new Float64Array(vocab.length);
  for (const i of memberIdx) {
    const v = vectors[i];
    if (v === undefined) continue;
    for (let j = 0; j < sums.length; j++) {
      sums[j] = (sums[j] ?? 0) + (v[j] ?? 0);
    }
  }
  const idx = Array.from({ length: vocab.length }, (_, i) => i);
  idx.sort((a, b) => (sums[b] ?? 0) - (sums[a] ?? 0));
  return idx
    .slice(0, k)
    .map((i) => vocab[i] ?? '')
    .filter((t) => t.length > 0 && (sums[vocab.indexOf(t)] ?? 0) > 0);
}
