export function freqToNote(f: number, a4 = 440) {
  const noteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const nFloat = 69 + 12 * Math.log2(f / a4);
  const nRound = Math.round(nFloat);
  const nearestFreq = a4 * Math.pow(2, (nRound - 69) / 12);
  const cents = Math.round(1200 * Math.log2(f / nearestFreq));
  const noteName = noteNames[(nRound + 3) % 12]; // 60 -> C4
  const octave = Math.floor(nRound / 12) - 1;
  return { noteName, octave, cents, midi: nRound, nearestFreq };
}

export function centsDiff(f1: number, f2: number) {
  return 1200 * Math.log2(f2 / f1);
}
