import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

if (!admin.apps.length) admin.initializeApp();

// EVERY function must talk to the app's NAMED database.
//
// `admin.firestore()` returns the (default) database. This project stores all
// of its data in a named one (see firebase.json "database" and the client's
// firestoreDatabaseId), so for the whole life of these functions the server
// side has been reading and writing a different, near-empty database from the
// app. Nothing errored — (default) exists, it is simply not where the data is.
//
// What that silently broke:
//   • Stripe webhooks wrote entitlement into (default). A user could pay and
//     the app, reading the named database, would never see the subscription.
//   • Every scheduled push (streak-risk, meal, win-back, workout reminders,
//     trial-ending) queried users from (default) and found only stubs, so no
//     nudge has ever been delivered.
//   • Weekly recaps were written where the app cannot read them.
//   • deleteAccount deleted from (default), leaving the real user data intact
//     in the named database — an account deletion that did not delete.
export const DATABASE_ID =
  process.env.FIRESTORE_DATABASE_ID || "ai-studio-0bcd2aaf-b5da-4706-b41f-bfc7daa1974e";
export const db = getFirestore(admin.app(), DATABASE_ID);
