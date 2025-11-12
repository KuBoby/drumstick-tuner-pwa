// Простой RMS-детектор удара: порог = средний шум + 4*σ
export class HitDetector {
  private mean = 0;
  private m2 = 0;
  private count = 0;
  private minRms = 0.01;

  constructor(private sampleRate: number) {}

  push(chunk: Float32Array) {
    let s = 0;
    for (let i = 0; i < chunk.length; i++) s += chunk[i] * chunk[i];
    const rms = Math.sqrt(s / chunk.length);

    this.count++;
    const delta = rms - this.mean;
    this.mean += delta / this.count;
    this.m2 += delta * (rms - this.mean);
    const variance = this.count > 1 ? this.m2 / (this.count - 1) : 0;
    const sigma = Math.sqrt(Math.max(variance, 1e-12));

    const threshold = this.mean + 4 * sigma;
    const hit = rms > Math.max(threshold, this.minRms);
    return { rms, threshold, hit };
  }
}
