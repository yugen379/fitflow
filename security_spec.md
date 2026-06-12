# Security Specification for FitFlow AI

## Data Invariants
1.  **User Ownership**: Users can only modify their own profile, meals, workouts, and social relationships (following).
2.  **Immutability**: `userId` in meals, workouts, posts, and comments must match the authenticated user and cannot be changed after creation. `createdAt` timestamps must be set via `request.time`.
3.  **Relational Sync**:
    *   To record a meal or workout, the user must have an existing profile.
    *   To comment on a post, the post must exist.
4.  **Social Integrity**:
    *   A user cannot follow themselves.
    *   Likes and comments increment the parent post's counters (handled via transactions/server-side logic, but rules must allow these specific updates if client-side increments are used, though counters are better handled by cloud functions or atomic increments if allowed). *Correction*: Since this is a standalone applet, I'll allow client-side atomic increments for counters if the user also creates the interaction record.
5.  **Premium Access**: Certain features might be restricted, but for now, we'll focus on core security.

## The Dirty Dozen Payloads (Denial Scenarios)

1.  **Identity Spoofing**: Attempt to create a meal for someone else's `userId`.
2.  **Shadow Fields**: Attempt to add an `isAdmin: true` field to a user profile.
3.  **Cross-User Edit**: Attempt to update another user's workout details.
4.  **Illegal Following**: A user trying to follow themselves.
5.  **Atomic bypass**: Attempting to like a post without the corresponding `likesCount` increment (if strictly enforced).
6.  **Timestamp Faking**: Providing a client-side timestamp instead of `request.time`.
7.  **Resource Poisoning**: Using a 1MB string as a `postId`.
8.  **Orphaned Comments**: Posting a comment on a non-existent `postId`.
9.  **Scale Exhaustion**: Trying to post 10,000 comments in a single batch (if rate limited, but rules can't easily do rate limiting besides basic size checks).
10. **State Skipping**: Trying to set a user's subscription to 'premium' without a valid transaction record (though rules only check data shape here).
11. **PII Leak**: A guest user trying to read all user profiles' private data (like weight/height).
12. **System Field Hijack**: Directly editing `streak` or `subscriptionType` if these are meant to be system-managed.

## Test Runner Plan
I will generate `firestore.rules` that address these.
