import { expect, it } from 'vitest';
import { generateDesignConcepts } from '../topology/generative-topology-engine';

it('does not recycle explicitly rejected topology variants when the search is exhausted', () => {
  const input = { envelope: { x: 2000, y: 2000, w: 38000, h: 29000 }, flatsPerFloor: 4 as const,
    unitTypes: ['2BHK', '2BHK', '2BHK', '2BHK'] as const, seed: 1, conceptLimit: 100 };
  const first = generateDesignConcepts(input);
  const rejected = [...first.concepts, ...(first.bestEffort ? [first.bestEffort] : [])].map(result => result.variantId);
  rejected.push(...first.rejected.map(result => result.variantId));
  expect(first.concepts.length).toBeGreaterThan(0);
  const exhausted = generateDesignConcepts({ ...input, rejectedTopologyHashes: rejected });
  const returned = [...exhausted.concepts, ...(exhausted.bestEffort ? [exhausted.bestEffort] : [])];
  expect(returned.map(candidate => candidate.variantId).filter(id => rejected.includes(id))).toEqual([]);
});
