import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firestore';
import { legacyWeightUnitFor, type UnitPrefs } from '../lib/units';

/**
 * Save the person's display units on their user doc (`units`, validated by
 * firestore.rules isValidUnits). Also writes the legacy `weightUnit` that
 * builds from before the units map still read. Display only: no stored
 * measurement is touched.
 */
export const saveUnitPrefs = (uid: string, next: UnitPrefs) =>
  updateDoc(doc(db, 'users', uid), {
    units: { system: next.system, weight: next.weight, energy: next.energy },
    weightUnit: legacyWeightUnitFor(next),
    updatedAt: serverTimestamp(),
  });
