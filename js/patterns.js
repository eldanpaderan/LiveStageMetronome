// patterns.js
// Reusable rhythm pattern system. Each pattern defines how many equal
// sub-clicks are played within a single "pulse" of the time signature,
// plus a relative gain curve so the first sub-click of a pulse is a hair
// stronger than the rest. Adding a new pattern only means adding an entry.

export const PATTERNS = {
  quarter: {
    id: 'quarter',
    label: 'Quarter Notes',
    subdivisions: 1,
    gains: [1],
  },
  eighth: {
    id: 'eighth',
    label: 'Eighth Notes',
    subdivisions: 2,
    gains: [1, 0.55],
  },
  sixteenth: {
    id: 'sixteenth',
    label: 'Sixteenth Notes',
    subdivisions: 4,
    gains: [1, 0.45, 0.6, 0.45],
  },
  triplet: {
    id: 'triplet',
    label: 'Triplets',
    subdivisions: 3,
    gains: [1, 0.5, 0.5],
  },
};

export const DEFAULT_PATTERN = 'quarter';

export function getPattern(id) {
  return PATTERNS[id] || PATTERNS[DEFAULT_PATTERN];
}

export function listPatterns() {
  return Object.values(PATTERNS);
}
