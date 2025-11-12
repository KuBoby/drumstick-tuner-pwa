import React, { useRef, useState } from 'react';
import { analyzeBuffer } from '../audio/analyzer';
import { HitDetector } from '../audio/hitDetector';
import { freqToNote } from '../logic/note';
import { addStick, listSticks, removeStick, Stick, suggestPairs } from '../store/sticksStore';

type Quality = 'низкое' | 'среднее' | 'высокое';
interface MeasureResult {
  freqHz: number;
  cents: number;
  note: string;
  octave: number;
  snrDb: number;
  quality: Quality;
}

const fMin = 500;
const fMax = 6000;
const HPF_HZ = 450;
const LPF_HZ = 6500;
const SKIP_MS = 30;
const CAPTURE_MS = 250;
const TARGET_MEASURES = 3;

export default function App() {
  const [tab, setTab] = useState<'measure' | 'list'>('measure');
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [last, setLast] = useState<MeasureResult | null>(null);
  const [series, setSeries] = useState<MeasureResult[]>([]);
  const [status, setStatus] = useState('Готово');
  const [sticks, setSticks] = useState<Stick[]>(listSticks());
  const [stickId, setStickId] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const hitRef = useRef<HitDetector | null>(null);
  const sampleRateRef = useRef<number>(48000);
  const capturingRef = useRef(false);
  const skipSamplesRef = useRef(0);
  const needSamplesRef = useRef(0);
  const captureBufRef = useRef<Float32Array | null>(null);
  const collectedRef = useRef(0);

  async function startMeasure() {
    if (isMeasuring) return;
    setStatus('Запрос доступа к микрофону…');
    setSeries([]);
    setLast(null);

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false
    });
    streamRef.current = stream;

    const AC: any = window.AudioContext || (window as any).webkitAudioContext;
    const ctx: AudioContext = new AC();
    ctxRef.current = ctx;
    sampleRateRef.current = ctx.sampleRate;

    const src = ctx.createMediaStreamSource(stream);
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = HPF_HZ;
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = LPF_HZ;

    const proc = ctx.createScriptProcessor(1024, 1, 1);
    procRef.current = proc;

    const mute = ctx.createGain();
    mute.gain.value = 0;

    src.connect(hpf);
    hpf.connect(lpf);
    lpf.connect(proc);
    proc.connect(mute);
    mute.connect(ctx.destination);

    hitRef.current = new HitDetector(ctx.sampleRate);
    resetCapture();

    proc.onaudioprocess = (ev) => {
      const input = ev.inputBuffer.getChannelData(0);
      const { hit } = hitRef.current!.push(input);

      if (!capturingRef.current) {
        if (hit) {
          skipSamplesRef.current = Math.floor((SKIP_MS / 1000) * sampleRateRef.current);
          needSamplesRef.current = Math.floor((CAPTURE_MS / 1000) * sampleRateRef.current);
          captureBufRef.current = new Float32Array(needSamplesRef.current);
          collectedRef.current = 0;
          capturingRef.current = true;
          setStatus('Захват сигнала…');
        }
        return;
      }

      let offset = 0;
      if (skipSamplesRef.current > 0) {
        const take = Math.min(skipSamplesRef.current, input.length);
        skipSamplesRef.current -= take;
        offset += take;
        if (offset >= input.length) return;
      }

      const remain = needSamplesRef.current - collectedRef.current;
      if (remain > 0) {
        const take = Math.min(remain, input.length - offset);
        captureBufRef.current!.set(input.subarray(offset, offset + take), collectedRef.current);
        collectedRef.current += take;
        offset += take;
      }

      if (collectedRef.current >= needSamplesRef.current) {
        capturingRef.current = false;
        const buf = captureBufRef.current!;
        analyzeBuffer(buf, sampleRateRef.current, fMin, fMax)
          .then((res) => {
            const { freqHz, snrDb } = res;
            const quality: Quality = snrDb < 8 ? 'низкое' : snrDb < 12 ? 'среднее' : 'высокое';
            const { noteName, octave, cents } = freqToNote(freqHz, 440);
            const result: MeasureResult = {
              freqHz, cents, note: noteName, octave, snrDb, quality
            };

            setSeries((prev) => {
              const next = [...prev, result];
              setLast(result);
              if (next.length >= TARGET_MEASURES) {
                const median = medianBy(next.map((x) => x.freqHz));
                const { noteName: n2, octave: o2, cents: c2 } = freqToNote(median, 440);
                const combined: MeasureResult = {
                  freqHz: median,
                  cents: c2,
                  note: n2,
                  octave: o2,
                  snrDb: avg(next.map((x) => x.snrDb)),
                  quality: classifyQuality(avg(next.map((x) => x.snrDb)))
                };
                setLast(combined);
                stopMeasure();
                setStatus('Готово');
              } else {
                setStatus(`Удар ${next.length}/${TARGET_MEASURES} — ждём следующий…`);
                resetCapture();
              }
              return next;
            });
          })
          .catch((e) => {
            console.error(e);
            setStatus('Ошибка анализа. Попробуйте ещё раз.');
            resetCapture();
          });
      }
    };

    if (ctx.state === 'suspended') await ctx.resume();
    setIsMeasuring(true);
    setStatus('Готовы. Лёгкий удар палочкой рядом с микрофоном.');
  }

  function resetCapture() {
    capturingRef.current = false;
    skipSamplesRef.current = 0;
    needSamplesRef.current = 0;
    captureBufRef.current = null;
    collectedRef.current = 0;
  }

  async function stopMeasure() {
    setIsMeasuring(false);
    try {
      procRef.current?.disconnect();
      if (procRef.current) procRef.current.onaudioprocess = null;
      if (ctxRef.current?.state !== 'closed') await ctxRef.current?.close();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {}
    ctxRef.current = null;
    procRef.current = null;
    streamRef.current = null;
    resetCapture();
  }

  function classifyQuality(snrDb: number): Quality {
    return snrDb < 8 ? 'низкое' : snrDb < 12 ? 'среднее' : 'высокое';
  }

  function saveStick() {
    if (!last) return;
    const id = (stickId || `П-${Date.now()}`).trim();
    const s: Stick = {
      stickId: id,
      freqHz: last.freqHz,
      note: last.note,
      octave: last.octave,
      cents: last.cents,
      quality: last.quality,
      createdAt: new Date().toISOString()
    };
    addStick(s);
    setStickId('');
    setSticks(listSticks());
    setTab('list');
    setSelectedId(id);
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: 16 }}>
      <h1 style={{ marginBottom: 8 }}>Тюнер палочек (PWA)</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={() => setTab('measure')} style={btn(tab === 'measure')}>Измерение</button>
        <button onClick={() => setTab('list')} style={btn(tab === 'list')}>Список/Пары</button>
      </div>

      {tab === 'measure' && (
        <>
          <p style={{ marginTop: 0, opacity: 0.85 }}>
            Диапазон: {fMin}–{fMax} Гц. Алгоритм: удар → пропуск {SKIP_MS} мс → анализ {CAPTURE_MS} мс (FFT).
          </p>

          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            {!isMeasuring ? (
              <button onClick={startMeasure} style={primary}>Измерить (3 удара)</button>
            ) : (
              <button onClick={stopMeasure} style={{ ...primary, background: '#7f1d1d' }}>Стоп</button>
            )}
          </div>

          <div style={{ marginBottom: 12, padding: 12, background: '#111827', borderRadius: 8 }}>
            <b>Статус:</b> {status}
          </div>

          {last && (
            <div style={{ padding: 12, background: '#111827', borderRadius: 8, marginBottom: 12 }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>
                {last.note}{last.octave} {fmtCents(last.cents)}
              </div>
              <div>Частота: {last.freqHz.toFixed(1)} Гц</div>
              <div>Качество: {last.quality} ({last.snrDb.toFixed(1)} дБ)</div>
            </div>
          )}

          {series.length > 0 && (
            <div style={{ padding: 12, background: '#0b1220', borderRadius: 8, marginBottom: 12 }}>
              <div style={{ marginBottom: 8 }}>Измерения:</div>
              <ol style={{ marginTop: 0 }}>
                {series.map((r, i) => (
                  <li key={i}>
                    {r.freqHz.toFixed(1)} Гц — {r.note}{r.octave} {fmtCents(r.cents)} — SNR {r.snrDb.toFixed(1)} дБ
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              placeholder="ID палочки (например, П-17)"
              value={stickId}
              onChange={(e) => setStickId(e.target.value)}
              style={inputStyle}
            />
            <button onClick={saveStick} disabled={!last} style={secondary}>Сохранить</button>
          </div>

          <div style={{ marginTop: 16, opacity: 0.8 }}>
            Подсказка: держите палочку на весу; ударяйте по ногтю/резине; микрофон — 10–20 см.
          </div>
        </>
      )}

      {tab === 'list' && (
        <ListTab
          sticks={sticks}
          onRefresh={() => setSticks(listSticks())}
          onRemove={(id) => { removeStick(id); setSticks(listSticks()); if (selectedId === id) setSelectedId(null); }}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(id)}
        />
      )}
    </div>
  );
}

function ListTab(props: {
  sticks: Stick[];
  onRefresh: () => void;
  onRemove: (id: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { sticks, onRemove, selectedId, onSelect } = props;
  const selected = sticks.find((s) => s.stickId === selectedId) || null;
  const suggestions = selected ? suggestPairs(selected, sticks) : [];

  return (
    <div>
      <div style={{ marginBottom: 8, opacity: 0.9 }}>
        Всего палочек: {sticks.length}
      </div>
      {sticks.length === 0 && <div>Пока пусто. Перейдите на вкладку «Измерение» и сохраните результат.</div>}

      <div style={{ display: 'grid', gap: 8 }}>
        {sticks.map((s) => (
          <div key={s.stickId} style={{
            padding: 10, borderRadius: 8, background: selectedId === s.stickId ? '#1e293b' : '#111827',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between'
          }}>
            <div style={{ cursor: 'pointer' }} onClick={() => onSelect(s.stickId)}>
              <b>{s.stickId}</b> — {s.note}{s.octave} {fmtCents(s.cents)} — {s.freqHz.toFixed(1)} Гц — {s.quality}
            </div>
            <button onClick={() => onRemove(s.stickId)} style={danger}>Удалить</button>
          </div>
        ))}
      </div>

      {selected && (
        <div style={{ marginTop: 16, padding: 12, background: '#0b1220', borderRadius: 8 }}>
          <div style={{ marginBottom: 8 }}>
            Выбрано: <b>{selected.stickId}</b> — {selected.note}{selected.octave} {fmtCents(selected.cents)} — {selected.freqHz.toFixed(1)} Гц
          </div>
          <div style={{ marginBottom: 8 }}>Подходящие пары:</div>
          {suggestions.length === 0 ? (
            <div>Нет подходящих пар по текущим допускам.</div>
          ) : (
            <ol style={{ marginTop: 0 }}>
              {suggestions.map((p) => (
                <li key={p.otherStickId}>
                  {p.otherStickId} — Δ{p.diffCents.toFixed(1)} ц — {p.class}
                </li>
              ))}
            </ol>
          )}
          <div style={{ marginTop: 8, opacity: 0.75 }}>
            Классы: Отличная ≤ 8 ц, Подходит 9–15 ц, Не рекомендуется &gt; 15 ц.
          </div>
        </div>
      )}
    </div>
  );
}

const primary: React.CSSProperties = {
  background: '#1f2937', color: '#e5e7eb', padding: '10px 16px', border: '1px solid #334155', borderRadius: 8, cursor: 'pointer'
};
const secondary: React.CSSProperties = { ...primary, background: '#0b1220' };
const danger: React.CSSProperties = { ...primary, background: '#7f1d1d', borderColor: '#7f1d1d' };
function btn(active: boolean): React.CSSProperties {
  return { ...primary, background: active ? '#334155' : '#1f2937' };
}
const inputStyle: React.CSSProperties = {
  flex: 1, minWidth: 250, padding: '10px 12px', borderRadius: 8, border: '1px solid #334155',
  background: '#0b1220', color: '#e5e7eb', outline: 'none'
};

function fmtCents(c: number) {
  return `(${c >= 0 ? '+' : ''}${c} ц)`;
}
function medianBy(arr: number[]) {
  const a = [...arr].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}
function avg(arr: number[]) { return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0; }
