import FFT from 'fft.js';

// Окно Хэннинга
export function hannWindow(buf: Float32Array) {
  const N = buf.length;
  for (let i = 0; i < N; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
    buf[i] *= w;
  }
}

// Параболическая интерполяция
export function parabolicInterp(mag: Float32Array, k: number) {
  const a = mag[k - 1] ?? mag[k];
  const b = mag[k];
  const g = mag[k + 1] ?? mag[k];
  const denom = a - 2 * b + g;
  const delta = denom !== 0 ? 0.5 * (a - g) / denom : 0;
  const refinedMag = b - 0.25 * (a - g) * delta;
  return { delta, refinedMag };
}

// Поиск пика + SNR
function findDominantPeakFromComplex(
  outComplex: Float64Array,
  sampleRate: number,
  fftSize: number,
  fMin: number,
  fMax: number
) {
  const binHz = sampleRate / fftSize;
  const half = fftSize / 2;
  const kMin = Math.max(1, Math.floor(fMin / binHz));
  const kMax = Math.min(half - 2, Math.ceil(fMax / binHz));

  const mag = new Float32Array(half);
  for (let k = 0; k < half; k++) {
    const re = outComplex[2 * k];
    const im = outComplex[2 * k + 1];
    mag[k] = Math.hypot(re, im);
  }

  let kPeak = kMin;
  for (let k = kMin; k <= kMax; k++) {
    if (mag[k] > mag[kPeak]) kPeak = k;
  }
  const { delta, refinedMag } = parabolicInterp(mag, kPeak);
  const peakIndex = kPeak + delta;
  const peakHz = peakIndex * binHz;

  // Оценка фона
  const win = 20;
  let sum = 0, count = 0;
  for (let k = Math.max(kMin, kPeak - win); k <= Math.min(kMax, kPeak + win); k++) {
    if (Math.abs(k - kPeak) <= 2) continue;
    sum += mag[k];
    count++;
  }
  const noise = count > 0 ? sum / count : 1e-9;
  const snrDb = 20 * Math.log10((refinedMag + 1e-12) / (noise + 1e-12));
  return { peakHz, snrDb };
}

export async function analyzeBuffer(
  time: Float32Array,
  sampleRate: number,
  fMin = 500,
  fMax = 6000
) {
  // Ближайшая степень двойки (<= длины)
  const N = nearestPow2(time.length);
  const slice = time.subarray(0, N);

  const windowed = new Float32Array(N);
  windowed.set(slice);
  hannWindow(windowed);

  // FFT
  const fft = new FFT(N);
  const input = new Float64Array(2 * N);
  for (let i = 0; i < N; i++) {
    input[2 * i] = windowed[i];
    input[2 * i + 1] = 0;
  }
  const out = new Float64Array(2 * N);
  fft.transform(out, input);

  const { peakHz, snrDb } = findDominantPeakFromComplex(out, sampleRate, N, fMin, fMax);
  return { freqHz: peakHz, snrDb };
}

function nearestPow2(n: number) {
  let p = 1;
  while (p * 2 <= n) p <<= 1;
  return p;
}
