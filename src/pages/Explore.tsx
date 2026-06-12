import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { db } from '../lib/firebase';
import { collection, addDoc, serverTimestamp, updateDoc, doc } from 'firebase/firestore';
import { motion } from 'motion/react';
import { Play, Square, Map as MapIcon, ChevronLeft, Footprints, Activity, Bike } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../hooks/useToast';
import { checkAndAwardBadge } from '../services/badgeService';

type Coord = { lat: number; lng: number; t: number };
type ActivityType = 'run' | 'walk' | 'cycle';

const haversine = (a: Coord, b: Coord) => {
  const R = 6371; // km
  const toRad = (n: number) => (n * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const formatTime = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
};

export const Explore: React.FC = () => {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [type, setType] = useState<ActivityType>('run');
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [path, setPath] = useState<Coord[]>([]);
  const [distance, setDistance] = useState(0);
  const [currentPos, setCurrentPos] = useState<GeolocationPosition | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);

  // Initial location
  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsError('Geolocation not supported on this device.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => setCurrentPos(pos),
      err => setGpsError(err.message),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, []);

  // Timer
  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 500);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isRecording]);

  // GPS watch
  useEffect(() => {
    if (!isRecording || !navigator.geolocation) return;
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const newPoint: Coord = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          t: Date.now(),
        };
        setCurrentPos(pos);
        setPath(prev => {
          const updated = [...prev, newPoint];
          // distance update
          if (prev.length > 0) {
            const last = prev[prev.length - 1];
            // ignore noisy points (<2 m or accuracy worse than 30 m)
            const segment = haversine(last, newPoint);
            if (segment * 1000 > 2 && pos.coords.accuracy < 30) {
              setDistance(d => d + segment);
              return updated;
            }
            return prev;
          }
          return updated;
        });
      },
      (err) => setGpsError(err.message),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 1000 },
    );
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, [isRecording]);

  const start = () => {
    setPath([]);
    setDistance(0);
    setDuration(0);
    startedAtRef.current = Date.now();
    setIsRecording(true);
    setGpsError(null);
    showToast(`${type === 'run' ? 'Run' : type === 'walk' ? 'Walk' : 'Ride'} started`);
  };

  const stop = async () => {
    setIsRecording(false);
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);

    if (path.length < 2) {
      showToast('Too short to save', 'info');
      return;
    }
    if (!profile?.uid) return;

    const km = parseFloat(distance.toFixed(3));
    const pace = duration > 0 ? duration / 60 / Math.max(km, 0.01) : 0; // min/km
    const cals = Math.round(km * 60 * (type === 'cycle' ? 0.6 : type === 'walk' ? 0.7 : 1));

    try {
      await addDoc(collection(db, 'activity_routes'), {
        userId: profile.uid,
        type,
        path,
        distance: km,
        duration,
        pace,
        caloriesBurned: cals,
        timestamp: serverTimestamp(),
      });
      await updateDoc(doc(db, 'users', profile.uid), {
        points: (profile.points || 0) + Math.floor(km * 100),
      });
      if (km >= 5) await checkAndAwardBadge(profile.uid, 'marathoner');
      showToast(`Saved · ${km.toFixed(2)} km`);
    } catch {
      showToast('Save failed', 'error');
    }
  };

  const pace = duration > 0 && distance > 0 ? duration / 60 / distance : 0;

  return (
    <div className="pb-24 pt-4 px-4 bg-bg min-h-screen flex flex-col">
      <header className="flex items-center gap-3 mb-5">
        <button onClick={() => navigate('/')} className="w-10 h-10 glass rounded-xl flex items-center justify-center text-text-dim hover:text-white" aria-label="Back"><ChevronLeft size={18} /></button>
        <div className="flex-1">
          <p className="text-eyebrow text-accent">Outdoor</p>
          <h1 className="font-display text-2xl font-bold text-white tracking-tight leading-tight">GPS tracker</h1>
        </div>
      </header>

      {!isRecording && (
        <div className="flex bg-surface rounded-2xl p-1 border border-white/[0.06] mb-4">
          {(['run', 'walk', 'cycle'] as ActivityType[]).map(t => {
            const Icon = t === 'run' ? Activity : t === 'walk' ? Footprints : Bike;
            const label = t === 'run' ? 'Run' : t === 'walk' ? 'Walk' : 'Ride';
            const active = type === t;
            return (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`flex-1 h-10 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold transition-all ${active ? 'bg-accent text-bg' : 'text-text-dim hover:text-white'}`}
              >
                <Icon size={14} /> {label}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex-1 space-y-4">
        <div className="glass overflow-hidden aspect-[4/5] relative">
          {/* Live path canvas */}
          <RoutePreview path={path} />

          {gpsError && !isRecording && (
            <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center bg-bg/80">
              <MapIcon size={32} className="text-text-dim mb-3" />
              <p className="text-white text-sm">{gpsError}</p>
              <p className="text-text-dim text-xs mt-2">Enable location to track your route.</p>
            </div>
          )}

          {path.length === 0 && !gpsError && (
            <div className="absolute inset-0 bg-surface-2 flex items-center justify-center">
              <div className="text-center space-y-3">
                <div className="w-16 h-16 rounded-full bg-accent/15 flex items-center justify-center relative mx-auto">
                  <div className="absolute inset-0 rounded-full bg-accent/20 animate-ping" />
                  <div className="w-4 h-4 rounded-full bg-accent relative" />
                </div>
                <p className="num text-xs text-text-dim">
                  {currentPos ? `${currentPos.coords.latitude.toFixed(4)}, ${currentPos.coords.longitude.toFixed(4)}` : 'Locating satellites…'}
                </p>
                {currentPos?.coords.accuracy && (
                  <p className="num text-[10px] text-text-mute">accuracy ±{Math.round(currentPos.coords.accuracy)}m</p>
                )}
              </div>
            </div>
          )}

          {isRecording && (
            <div className="absolute top-4 right-4 flex items-center gap-2 bg-bg/70 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/[0.06]">
              <div className="w-2 h-2 rounded-full bg-accent-2 animate-pulse" />
              <span className="text-xs text-white font-medium">Recording</span>
            </div>
          )}
        </div>

        <div className="glass p-5 grid grid-cols-3 gap-3">
          <Metric label="Distance" value={distance.toFixed(2)} unit="km" />
          <Metric label="Time" value={formatTime(duration)} />
          <Metric label="Pace" value={pace > 0 ? pace.toFixed(2) : '—'} unit="min/km" />
        </div>

        <button
          onClick={isRecording ? stop : start}
          disabled={!!gpsError && !isRecording}
          className={`w-full h-14 rounded-2xl flex items-center justify-center gap-2 font-semibold transition-all active:scale-[0.98] disabled:opacity-50 ${
            isRecording
              ? 'bg-accent-2 text-white shadow-[0_14px_40px_-10px_rgba(255,107,107,0.5)]'
              : 'btn-3d'
          }`}
        >
          {isRecording ? (<><Square size={16} fill="currentColor" /> Stop & save</>) : (<><Play size={16} fill="currentColor" /> Start {type}</>)}
        </button>
      </div>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: string; unit?: string }> = ({ label, value, unit }) => (
  <div className="text-center">
    <p className="text-xs text-text-dim font-medium">{label}</p>
    <p className="num font-display text-2xl font-bold text-white mt-1 leading-none">{value}</p>
    {unit && <p className="text-xs text-text-dim mt-1">{unit}</p>}
  </div>
);

const RoutePreview: React.FC<{ path: Coord[] }> = ({ path }) => {
  if (path.length < 2) return null;
  const lats = path.map(p => p.lat);
  const lngs = path.map(p => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const pad = 0.0001;
  const w = Math.max(maxLng - minLng, pad);
  const h = Math.max(maxLat - minLat, pad);
  const aspect = w / h;
  // viewBox 0..100 in each axis, padded
  const points = path.map(p => {
    const x = ((p.lng - minLng) / w) * 90 + 5;
    const y = 95 - ((p.lat - minLat) / h) * 90;
    return { x, y };
  });
  const d = points.reduce((acc, pt, i) => acc + (i === 0 ? `M${pt.x} ${pt.y}` : ` L${pt.x} ${pt.y}`), '');
  const last = points[points.length - 1];
  const first = points[0];

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio={aspect > 1 ? 'xMidYMid meet' : 'xMidYMid meet'}
      className="absolute inset-0 w-full h-full bg-surface-2"
    >
      <defs>
        <linearGradient id="routeGrad" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#9CFF1F" />
          <stop offset="100%" stopColor="#C6FF3D" />
        </linearGradient>
      </defs>
      {/* grid */}
      {[20, 40, 60, 80].map(g => (
        <React.Fragment key={g}>
          <line x1={g} y1="0" x2={g} y2="100" stroke="rgba(255,255,255,0.03)" strokeWidth="0.3" />
          <line x1="0" y1={g} x2="100" y2={g} stroke="rgba(255,255,255,0.03)" strokeWidth="0.3" />
        </React.Fragment>
      ))}
      {/* path */}
      <path d={d} fill="none" stroke="url(#routeGrad)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      {/* start */}
      <circle cx={first.x} cy={first.y} r="2" fill="#9CFF1F" />
      {/* current */}
      <circle cx={last.x} cy={last.y} r="3" fill="#C6FF3D" />
      <circle cx={last.x} cy={last.y} r="5" fill="#C6FF3D" opacity="0.3" className="ring-pulse" />
    </svg>
  );
};
