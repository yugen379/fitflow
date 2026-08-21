/**
 * One step number for the whole app.
 *
 * FitFlow has two possible sources and they must never both be on screen:
 *   • Health Connect on native, where the OS counted steps at kernel level even
 *     while the app was closed. Authoritative whenever it is available.
 *   • The web pedometer (`lib/pedometer.ts`) for PWA users, who have no Health
 *     Connect at all.
 *
 * This hook picks one, and says which. When Health Connect reports a count it
 * wins and is folded into the pedometer's store so the two never diverge; when
 * it is absent the sensor drives. The `source` field is exposed so the UI can be
 * honest about where the number came from rather than implying a wearable.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  formatActiveTime,
  isPedometerSupported,
  kmToMiles,
  pedometer,
  snapshotFrom,
  localDateKey,
} from '../lib/pedometer';
import type { PedometerStatus, StepSnapshot } from '../lib/pedometer';

export type StepSource = 'health-connect' | 'device-sensor' | 'none';

export interface StepState extends StepSnapshot {
  source: StepSource;
  status: PedometerStatus;
  /** True when the sensor needs an explicit user gesture (iOS). */
  needsPermission: boolean;
  supported: boolean;
}

interface Options {
  /** Steps from Health Connect, when connected. */
  deviceSteps?: number | null;
  /** Whether to start the sensor at all. */
  enabled?: boolean;
}

export const useSteps = ({ deviceSteps = null, enabled = true }: Options = {}): StepState & {
  requestPermission: () => Promise<void>;
} => {
  const [snapshot, setSnapshot] = useState<StepSnapshot>(() => snapshotFrom(localDateKey(), 0, 0));
  const [status, setStatus] = useState<PedometerStatus>('idle');

  useEffect(() => {
    const unsubscribe = pedometer.subscribe((next, nextStatus) => {
      setSnapshot(next);
      setStatus(nextStatus);
    });
    return unsubscribe;
  }, []);

  // Only run the sensor when there is no authoritative OS count to defer to.
  useEffect(() => {
    if (!enabled) return;
    if (deviceSteps !== null && deviceSteps > 0) return;
    void pedometer.start();
    return () => pedometer.stop();
  }, [enabled, deviceSteps]);

  // Health Connect wins whenever it reports.
  useEffect(() => {
    if (deviceSteps === null || deviceSteps <= 0) return;
    void pedometer.adoptDeviceCount(deviceSteps);
  }, [deviceSteps]);

  const requestPermission = useCallback(async () => {
    const next = await pedometer.requestPermission();
    setStatus(next);
  }, []);

  const source: StepSource =
    deviceSteps !== null && deviceSteps > 0
      ? 'health-connect'
      : status === 'running'
        ? 'device-sensor'
        : 'none';

  return {
    ...snapshot,
    source,
    status,
    needsPermission: status === 'permission-required',
    supported: isPedometerSupported(),
    requestPermission,
  };
};

export { formatActiveTime, kmToMiles };
