import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Volume2, VolumeX, Sparkles, AlertTriangle, CheckCircle2, Camera as CameraIcon, RefreshCcw } from 'lucide-react';
import { analyzeFormFrame, FormFeedback } from '../services/geminiService';
import { PoseOverlay } from './PoseOverlay';
import type { FormVerdict } from '../lib/formRules';

export interface FormCheckSummary {
  exerciseName: string;
  samples: number;
  avgRating: number;
  worstStatus: 'good' | 'fix' | 'danger';
  topCues: string[];
  durationSec: number;
}

interface Props {
  exerciseName: string;
  onClose: (summary?: FormCheckSummary) => void;
}

const INTERVAL_MS = 3000; // analyze every 3 seconds

export const FormCheck: React.FC<Props> = ({ exerciseName, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastSpokenRef = useRef<string>('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inflightRef = useRef(false);
  const startedAtRef = useRef<number>(Date.now());
  const allSamplesRef = useRef<FormFeedback[]>([]);
  // Rolling window of measured verdicts. Capped because this fills at ~20 Hz.
  const measuredRef = useRef<{ status: FormVerdict['status']; score: number; cue?: string }[]>([]);

  /**
   * Summary from MEASURED geometry when the on-device model ran. Joint angles
   * beat a language model's read of a JPEG, so those win when both exist; the
   * Gemini path stays as the fallback for devices that could not load the model.
   */
  const buildMeasuredSummary = (): FormCheckSummary | undefined => {
    const m = measuredRef.current;
    if (m.length === 0) return undefined;
    const avgRating = Math.round((m.reduce((a, s) => a + s.score, 0) / m.length / 10) * 10) / 10;
    const worstStatus: FormCheckSummary['worstStatus'] =
      m.some(s => s.status === 'danger') ? 'danger'
      : m.some(s => s.status === 'fix') ? 'fix'
      : 'good';
    // Rank cues by how often they actually fired, not by recency — a fault seen
    // on 40% of frames matters more than one glimpsed in the last rep.
    const counts = new Map<string, number>();
    for (const s of m) if (s.cue) counts.set(s.cue, (counts.get(s.cue) ?? 0) + 1);
    const topCues = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c);
    return {
      exerciseName,
      samples: m.length,
      avgRating,
      worstStatus,
      topCues,
      durationSec: Math.round((Date.now() - startedAtRef.current) / 1000),
    };
  };

  const buildSummary = (): FormCheckSummary | undefined => {
    const measured = buildMeasuredSummary();
    if (measured) return measured;
    const valid = allSamplesRef.current.filter(s => s.rating > 0);
    if (valid.length === 0) return undefined;
    const avgRating = Math.round((valid.reduce((a, s) => a + s.rating, 0) / valid.length) * 10) / 10;
    const worstStatus =
      valid.some(s => s.status === 'danger') ? 'danger'
      : valid.some(s => s.status === 'fix') ? 'fix'
      : 'good';
    // Top cues = most recent distinct non-empty cues, capped at 3.
    const seen = new Set<string>();
    const topCues: string[] = [];
    for (const s of valid) {
      if (s.cue && !seen.has(s.cue)) {
        seen.add(s.cue);
        topCues.push(s.cue);
        if (topCues.length === 3) break;
      }
    }
    return {
      exerciseName,
      samples: valid.length,
      avgRating,
      worstStatus,
      topCues,
      durationSec: Math.round((Date.now() - startedAtRef.current) / 1000),
    };
  };

  const handleClose = () => onClose(buildSummary());

  const [feedback, setFeedback] = useState<FormFeedback | null>(null);
  const [history, setHistory] = useState<FormFeedback[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [paused, setPaused] = useState(false);
  // Measured, on-device verdict — updates ~20x/sec, independent of Gemini.
  const [verdict, setVerdict] = useState<FormVerdict | null>(null);
  // null = still loading the model; false = unavailable, run Gemini-only.
  const [poseReady, setPoseReady] = useState<boolean | null>(null);

  const lastMeasuredSpokenRef = useRef<string>('');

  /**
   * Every analysed frame. Records the sample, and speaks only when a DANGER
   * fault appears — at ~20 Hz anything chattier would talk over itself, and a
   * joint under load in a bad position is the one thing worth interrupting for.
   */
  const handleVerdict = useCallback((v: FormVerdict | null) => {
    setVerdict(v);
    if (!v) return;
    const cue = v.issues[0]?.cue;
    measuredRef.current.push({ status: v.status, score: v.score, cue });
    if (measuredRef.current.length > 400) measuredRef.current.shift();

    if (voiceOn && v.status === 'danger' && cue && cue !== lastMeasuredSpokenRef.current && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(cue);
      u.rate = 1.05;
      window.speechSynthesis.speak(u);
      lastMeasuredSpokenRef.current = cue;
      lastSpokenRef.current = cue;
    }
    if (v.status !== 'danger') lastMeasuredSpokenRef.current = '';
  }, [voiceOn]);

  const start = useCallback(async (mode: 'user' | 'environment') => {
    setError(null);
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 720 }, height: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch (e: any) {
      setError(e?.message?.includes('Permission') ? 'Camera access denied.' : 'Could not start camera.');
    }
  }, []);

  useEffect(() => {
    start(facingMode);
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.speechSynthesis?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode]);

  const captureAndAnalyze = useCallback(async () => {
    if (paused || inflightRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;

    inflightRef.current = true;
    setIsAnalyzing(true);
    try {
      const w = 512;
      const h = Math.round((video.videoHeight / video.videoWidth) * w) || 768;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      const b64 = dataUrl.split(',')[1];

      const fb = await analyzeFormFrame(b64, exerciseName);
      setFeedback(fb);
      setHistory(prev => [fb, ...prev].slice(0, 5));
      allSamplesRef.current = [fb, ...allSamplesRef.current].slice(0, 60);

      if (voiceOn && fb.cue && fb.cue !== lastSpokenRef.current && window.speechSynthesis) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(fb.cue);
        u.rate = 1.05;
        window.speechSynthesis.speak(u);
        lastSpokenRef.current = fb.cue;
      }
    } catch {
      // swallow — next tick will retry
    } finally {
      setIsAnalyzing(false);
      inflightRef.current = false;
    }
  }, [exerciseName, voiceOn, paused]);

  useEffect(() => {
    intervalRef.current = setInterval(captureAndAnalyze, INTERVAL_MS);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [captureAndAnalyze]);

  // Measured geometry wins whenever it is available: it is objective and it is
  // current, where a Gemini sample can be up to INTERVAL_MS stale. Gemini's
  // sentence is kept as the secondary line — it is the better coach, just the
  // slower one.
  const shownStatus = verdict?.status ?? feedback?.status;
  const shownCue =
    verdict
      ? (verdict.issues[0]?.cue ?? 'Good form — hold that.')
      : feedback?.cue;
  const shownDetail = verdict ? feedback?.cue : feedback?.details;
  const shownScore = verdict ? Math.round(verdict.score / 10) : feedback?.rating;

  const statusColor =
    shownStatus === 'good' ? 'text-accent'
    : shownStatus === 'danger' ? 'text-accent-2'
    : 'text-accent-3';

  const StatusIcon =
    shownStatus === 'good' ? CheckCircle2
    : shownStatus === 'danger' ? AlertTriangle
    : Sparkles;

  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 28, stiffness: 280 }}
      className="fixed inset-0 z-[90] bg-bg flex flex-col"
    >
      <div className="px-5 pt-5 pb-3 flex justify-between items-center">
        <div>
          <p className="text-eyebrow text-accent">AI form check</p>
          <h2 className="font-display text-xl font-bold text-white tracking-tight">{exerciseName}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setVoiceOn(v => !v)}
            className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-colors ${voiceOn ? 'bg-accent/12 border-accent/30 text-accent' : 'glass text-text-dim'}`}
            aria-label="Toggle voice"
          >
            {voiceOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          <button
            onClick={() => setFacingMode(m => m === 'user' ? 'environment' : 'user')}
            className="w-10 h-10 glass rounded-xl flex items-center justify-center text-text-dim hover:text-white"
            aria-label="Flip camera"
          >
            <RefreshCcw size={16} />
          </button>
          <button
            onClick={handleClose}
            className="w-10 h-10 glass rounded-xl flex items-center justify-center text-text-dim hover:text-white"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="relative flex-1 bg-black overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
          style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }}
        />
        {/* Frame-grab scratch canvas for the Gemini call — never displayed. */}
        <canvas ref={canvasRef} className="hidden" />

        {/* The live skeleton. Mirrored in lockstep with the video so the lines
            sit on the body rather than its reflection. */}
        {!error && (
          <PoseOverlay
            videoRef={videoRef}
            exerciseName={exerciseName}
            mirrored={facingMode === 'user'}
            paused={paused}
            onVerdict={handleVerdict}
            onReady={setPoseReady}
          />
        )}

        {poseReady === null && !error && (
          <div className="absolute inset-x-0 bottom-24 flex justify-center pointer-events-none">
            <div className="glass rounded-full px-4 py-2 text-xs text-text-dim">
              Loading body tracking…
            </div>
          </div>
        )}

        {poseReady === true && !verdict && !error && (
          <div className="absolute inset-x-0 bottom-24 flex justify-center pointer-events-none">
            <div className="glass rounded-full px-4 py-2 text-xs text-text-dim">
              Step back so your whole body is in frame
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center bg-bg/80">
            <CameraIcon size={36} className="text-text-dim mb-3" />
            <p className="text-white font-medium">{error}</p>
            <button onClick={() => start(facingMode)} className="btn-3d mt-5 h-11 px-6">Try again</button>
          </div>
        )}

        {/* Live feedback overlay */}
        <div className="absolute inset-x-0 top-4 flex justify-center px-4 pointer-events-none">
          <AnimatePresence mode="wait">
            {shownStatus && shownCue && (
              <motion.div
                key={shownCue}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="bg-bg/80 backdrop-blur-xl border border-white/[0.08] rounded-2xl px-4 py-3 flex items-center gap-3 max-w-md pointer-events-auto"
              >
                <StatusIcon size={18} className={statusColor} />
                <div className="flex-1">
                  <p className="text-white text-sm font-medium leading-tight">{shownCue}</p>
                  {shownDetail && shownDetail !== shownCue && (
                    <p className="text-text-dim text-xs mt-1 leading-snug">{shownDetail}</p>
                  )}
                </div>
                <span className={`num text-xl font-bold ${statusColor}`}>{shownScore || '–'}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Analyzing indicator */}
        <div className="absolute bottom-4 left-4 flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isAnalyzing ? 'bg-accent animate-pulse' : 'bg-accent/40'}`} />
          <span className="text-xs text-white/70 font-medium">
            {paused ? 'Paused' : isAnalyzing ? 'Analyzing…' : `Live · every ${INTERVAL_MS / 1000}s`}
          </span>
        </div>
      </div>

      <div className="px-5 py-4 bg-surface/80 backdrop-blur-xl border-t border-white/[0.06]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setPaused(p => !p)}
            className="flex-1 btn-ghost h-12"
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button
            onClick={handleClose}
            className="flex-1 btn-3d h-12"
          >
            Done
          </button>
        </div>
        {history.length > 1 && (
          <div className="mt-3 flex items-center gap-1.5">
            {history.slice().reverse().map((h, i) => (
              <div
                key={i}
                className={`flex-1 h-1.5 rounded-full ${
                  h.status === 'good' ? 'bg-accent' : h.status === 'danger' ? 'bg-accent-2' : 'bg-accent-3'
                }`}
                title={`${h.rating}/10 — ${h.cue}`}
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
};
