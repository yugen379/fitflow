/**
 * Bridge to the native GPS recorder
 * (android/app/src/main/java/com/fitflow/app/gps/). Only imported by the lazy
 * /track-activity route, so none of this is on the boot path.
 *
 * Native: a `location` foreground service writes every fix to an append-only
 * file, so the route survives the WebView or the whole process being killed;
 * the page polls getCurrent({ since }) for new points.
 *
 * Web / PWA: falls back to navigator.geolocation.watchPosition, which only
 * works while the page is open and the screen is on. The UI says so.
 */

import { registerPlugin, Capacitor } from '@capacitor/core';
import type { GpsActivity, GpsPoint } from './gpsMath';

export type RecordingState = 'idle' | 'recording' | 'paused' | 'stopped';
type PermissionValue = 'prompt' | 'prompt-with-rationale' | 'granted' | 'denied';

export interface GpsStatus {
  location: PermissionValue;
  preciseLocation: boolean;
  notifications: PermissionValue;
  gpsHardware: boolean;
  gpsEnabled: boolean;
  state: RecordingState;
  serviceRunning: boolean;
}

export interface GpsSnapshot {
  state: RecordingState;
  activity: GpsActivity;
  startedAt: number;
  elapsedMs: number;
  pointCount: number;
  gpsEnabled: boolean;
  points: GpsPoint[];
  /** Index the returned points start at. */
  since: number;
}

interface GpsTrackerPlugin {
  getStatus(): Promise<GpsStatus>;
  checkPermissions(): Promise<{ location: PermissionValue; notifications: PermissionValue }>;
  requestPermissions(opts?: { permissions: ('location' | 'notifications')[] }): Promise<{ location: PermissionValue; notifications: PermissionValue }>;
  openLocationSettings(): Promise<void>;
  /** distanceUnit only changes the ongoing notification's text; data stays metres. */
  start(opts: { activity: GpsActivity; distanceUnit?: 'km' | 'mi' }): Promise<GpsSnapshot>;
  setDistanceUnit(opts: { unit: 'km' | 'mi' }): Promise<void>;
  pause(): Promise<GpsSnapshot>;
  resume(): Promise<GpsSnapshot>;
  stop(): Promise<GpsSnapshot>;
  getCurrent(opts: { since: number }): Promise<GpsSnapshot>;
  clear(): Promise<void>;
}

export const GpsTracker = registerPlugin<GpsTrackerPlugin>('GpsTracker');

/** The notification's distance unit for the profile's unit system (display only; data stays metres). */
export const nativeDistanceUnit = (system: string): 'km' | 'mi' => (system === 'imperial' ? 'mi' : 'km');

export const hasNativeGps = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('GpsTracker');

/** Plain-language message for a plugin rejection code. */
export function gpsErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code;
  switch (code) {
    case 'PERMISSION_DENIED':
      return 'FitFlow needs location access to record your route. Allow it, or turn it on in Settings › Apps › FitFlow › Permissions.';
    case 'PRECISE_REQUIRED':
      return 'Approximate location can’t trace a route. Switch FitFlow to “Precise” location in Settings › Apps › FitFlow › Permissions › Location.';
    case 'GPS_DISABLED':
      return 'Location is turned off on this phone. Turn it on to record.';
    case 'NO_GPS':
      return 'This device has no GPS, so it can’t record a route.';
    case 'ALREADY_ACTIVE':
      return 'A recording is already running.';
    default:
      return (err as Error)?.message || 'Could not start GPS recording.';
  }
}

// ---------------------------------------------------------------- web fallback

/** Screen-on-only recorder for browsers / PWA. Same shape as the native snapshot. */
export class WebGpsRecorder {
  private watchId: number | null = null;
  private points: GpsPoint[] = [];
  private seg = 0;
  private activeMs = 0;
  private resumedAt = 0;
  state: RecordingState = 'idle';
  activity: GpsActivity = 'walk';
  startedAt = 0;
  lastError: string | null = null;

  static available(): boolean {
    return typeof navigator !== 'undefined' && 'geolocation' in navigator;
  }

  start(activity: GpsActivity) {
    this.activity = activity;
    this.points = [];
    this.seg = 0;
    this.activeMs = 0;
    this.startedAt = Date.now();
    this.resumedAt = this.startedAt;
    this.state = 'recording';
    this.watch();
  }

  private watch() {
    this.unwatch();
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (this.state !== 'recording') return;
        const c = pos.coords;
        this.points.push({
          lat: c.latitude,
          lng: c.longitude,
          t: pos.timestamp || Date.now(),
          acc: Number.isFinite(c.accuracy) ? c.accuracy : undefined,
          alt: c.altitude ?? undefined,
          spd: c.speed ?? undefined,
          seg: this.seg,
        });
        this.lastError = null;
      },
      (err) => {
        this.lastError = err.code === err.PERMISSION_DENIED
          ? 'Location permission was denied in this browser.'
          : 'Waiting for a GPS fix…';
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
  }

  private unwatch() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }

  pause() {
    if (this.state !== 'recording') return;
    this.activeMs += Date.now() - this.resumedAt;
    this.state = 'paused';
    this.unwatch();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.seg += 1;
    this.resumedAt = Date.now();
    this.state = 'recording';
    this.watch();
  }

  stop() {
    this.pause();
    this.state = 'stopped';
  }

  clear() {
    this.unwatch();
    this.points = [];
    this.state = 'idle';
  }

  snapshot(since: number): GpsSnapshot {
    const elapsedMs = this.activeMs + (this.state === 'recording' ? Date.now() - this.resumedAt : 0);
    return {
      state: this.state,
      activity: this.activity,
      startedAt: this.startedAt,
      elapsedMs,
      pointCount: this.points.length,
      gpsEnabled: true,
      points: this.points.slice(since),
      since,
    };
  }
}
