/**
 * Tag-Based Discovery Service
 *
 * Given a task description and a set of candidate agents (valid TO targets),
 * ranks candidates by tag relevance using keyword extraction + scoring.
 * Pure algorithmic — no LLM call needed.
 */

import type { AgentCapability } from '../types/agent-metadata.js';

export interface DiscoveryCandidate {
  nodeId: string;
  label: string;
  tags: string[];
  capabilities: AgentCapability[];
  description?: string;
}

export interface RankedCandidate extends DiscoveryCandidate {
  score: number;
  matchedTags: string[];
}

// Common stop words to exclude from keyword extraction
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'this', 'that', 'these',
  'those', 'it', 'its', 'my', 'your', 'our', 'their', 'we', 'you',
  'they', 'i', 'me', 'him', 'her', 'us', 'them', 'not', 'no', 'so',
  'if', 'then', 'else', 'when', 'up', 'out', 'all', 'each', 'every',
  'both', 'few', 'more', 'most', 'other', 'some', 'such', 'only', 'also',
  'just', 'than', 'too', 'very', 'about', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'same', 'different',
  'use', 'make', 'like', 'need', 'want', 'get', 'set', 'new', 'old',
]);

function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

function computeRelevanceScore(
  taskTokens: Set<string>,
  candidate: DiscoveryCandidate,
): { score: number; matchedTags: string[] } {
  const matchedTags: string[] = [];
  let score = 0;

  // Direct tag match (highest weight)
  for (const tag of candidate.tags) {
    const tagLower = tag.toLowerCase();
    if (taskTokens.has(tagLower)) {
      matchedTags.push(tag);
      score += 0.3;
    } else {
      // Partial match: task token contains tag or vice versa
      for (const token of taskTokens) {
        if (token.includes(tagLower) || tagLower.includes(token)) {
          if (!matchedTags.includes(tag)) matchedTags.push(tag);
          score += 0.15;
          break; // Only count once per tag
        }
      }
    }
  }

  // Capability match (medium weight)
  for (const cap of candidate.capabilities) {
    const capTokens = extractKeywords(`${cap.id} ${cap.description}`);
    const overlap = [...taskTokens].filter(t => capTokens.has(t)).length;
    score += overlap * 0.1;
  }

  // Description match (lower weight)
  if (candidate.description) {
    const descTokens = extractKeywords(candidate.description);
    const overlap = [...taskTokens].filter(t => descTokens.has(t)).length;
    score += overlap * 0.05;
  }

  // Label match (medium weight)
  const labelTokens = extractKeywords(candidate.label.replace(/[-_]/g, ' '));
  const labelOverlap = [...taskTokens].filter(t => labelTokens.has(t)).length;
  score += labelOverlap * 0.2;

  return { score: Math.min(1.0, score), matchedTags };
}

/**
 * Rank candidates by relevance to a task description.
 * Returns candidates sorted by score descending.
 */
export function rankCandidatesByRelevance(
  taskDescription: string,
  candidates: DiscoveryCandidate[],
): RankedCandidate[] {
  const taskTokens = extractKeywords(taskDescription);

  return candidates
    .map(candidate => {
      const { score, matchedTags } = computeRelevanceScore(taskTokens, candidate);
      return { ...candidate, score, matchedTags };
    })
    .sort((a, b) => b.score - a.score);
}
