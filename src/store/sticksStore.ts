import { centsDiff } from '../logic/note';

export type Quality = 'низкое' | 'среднее' | 'высокое';

export interface Stick {
  stickId: string;
  freqHz: number;
  note: string;
  octave: number;
  cents: number;
  quality: Quality;
  createdAt: string;
}

const KEY = 'sticks';

export function listSticks(): Stick[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Stick[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveAll(arr: Stick[]) {
  localStorage.setItem(KEY, JSON.stringify(arr));
}

export function addStick(s: Stick) {
  const arr = listSticks();
  const idx = arr.findIndex((x) => x.stickId === s.stickId);
  if (idx >= 0) arr[idx] = s; else arr.push(s);
  saveAll(arr);
}

export function removeStick(stickId: string) {
  const arr = listSticks().filter((s) => s.stickId !== stickId);
  saveAll(arr);
}

export interface PairSuggestion {
  otherStickId: string;
  diffCents: number;
  class: 'Отличная' | 'Подходит' | 'Не рекомендуется';
}

export function suggestPairs(target: Stick, all: Stick[], topN = 3): PairSuggestion[] {
  const EXCELLENT = 8;
  const GOOD = 15;
  const candidates: PairSuggestion[] = [];
  for (const s of all) {
    if (s.stickId === target.stickId) continue;
    const dc = Math.abs(centsDiff(target.freqHz, s.freqHz));
    const cls = dc <= EXCELLENT ? 'Отличная' : dc <= GOOD ? 'Подходит' : 'Не рекомендуется';
    candidates.push({ otherStickId: s.stickId, diffCents: dc, class: cls });
  }
  return candidates
    .filter((p) => p.class !== 'Не рекомендуется')
    .sort((a, b) => a.diffCents - b.diffCents)
    .slice(0, topN);
}
