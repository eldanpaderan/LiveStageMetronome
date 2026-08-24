// meters.js
// Time signature definitions. Each meter is described as a list of
// "pulses" per measure. Each pulse's value is measured in eighth-note
// units. This lets compound meters (6/8, 9/8, 12/8) group their eighths
// into dotted-quarter pulses instead of clicking every eighth the same,
// while simple meters (2/4, 3/4, 4/4, 5/4) get one pulse per quarter note.
//
// The metronome's BPM dial always refers to the QUARTER NOTE, matching
// how musicians actually count in ("quarter = 146"), regardless of meter.
// Each pulse's real duration = (pulseValueInEighths / 2) * secondsPerQuarter.
//
// To add a new time signature, just add an entry here — nothing else
// needs to change.

export const METERS = {
  '2/4': { label: '2/4', pulses: [2, 2] },
  '3/4': { label: '3/4', pulses: [2, 2, 2] },
  '4/4': { label: '4/4', pulses: [2, 2, 2, 2] },
  '5/4': { label: '5/4', pulses: [2, 2, 2, 2, 2] },
  '6/8': { label: '6/8', pulses: [3, 3] },
  '7/8': { label: '7/8', pulses: [3, 2, 2] }, // common 3+2+2 grouping
  '9/8': { label: '9/8', pulses: [3, 3, 3] },
  '12/8': { label: '12/8', pulses: [3, 3, 3, 3] },
};

export const DEFAULT_METER = '4/4';

export function getMeter(id) {
  return METERS[id] || METERS[DEFAULT_METER];
}

export function listMeters() {
  return Object.keys(METERS).map((id) => ({ id, ...METERS[id] }));
}
