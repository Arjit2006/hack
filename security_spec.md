# EcoIntelligence Security Specification (Phase 0)

## 1. Data Invariants
1. A user profile (`users/{userId}`) can only be read or created by the authenticated user matching `userId` (or an `ADMIN`/`SUPER_ADMIN`), and a user can never self-assign `role: "ADMIN"` or `status: "suspended"`.
2. Administrator privileges (`adminUsers/{userId}`) can never be granted by a normal user; only a `SUPER_ADMIN` (or the bootstrapped admin email `kuku42615@gmail.com` with `email_verified == true`) can create or update admin role documents.
3. User-owned collections (`savedLocations`, `wqiResults`, `wmiResults`, `notifications`, `reports`) must always require `incoming().userId == request.auth.uid`, enforce `userId` immutability on update, and restrict `list` queries via `resource.data.userId == request.auth.uid` (or `isAdmin()`).
4. `auditLogs` are append-only: neither users nor admins can modify or delete existing audit entries.
5. `methodologyVersions` and `systemSettings` can only be written by verified admins (`isAdmin()`), never by standard users.

## 2. "Dirty Dozen" Adversarial Payloads (Must All Return PERMISSION_DENIED)
1. **Unauthenticated read on `users/u1`**: No auth context -> DENIED.
2. **Cross-user read on `users/u2` by `u1`**: `auth.uid == 'u1'` -> DENIED.
3. **Self-privilege escalation on `users/u1` create**: `{ uid: 'u1', role: 'ADMIN', ... }` -> DENIED.
4. **Shadow field injection on `users/u1` create**: `{ uid: 'u1', role: 'USER', isAdmin: true, ... }` -> DENIED.
5. **Status tamper on `users/u1` update by owner**: changing `status` from `'suspended'` to `'active'` -> DENIED.
6. **ID poisoning on `savedLocations`**: document ID with 200+ invalid chars or slashes -> DENIED.
7. **Unverified email write on `savedLocations`**: `email_verified: false` -> DENIED.
8. **Spoofed ownership on `wqiResults` create**: `{ userId: 'victim_uid', ... }` by `'attacker_uid'` -> DENIED.
9. **Blanket list scraping on `notifications`**: listing without `userId == request.auth.uid` -> DENIED.
10. **Standard user creating `adminUsers/attacker`**: non-admin attempts admin grant -> DENIED.
11. **Standard user mutating `systemSettings/global`**: non-admin attempts config tamper -> DENIED.
12. **Audit log tampering**: anyone attempting `update` or `delete` on `auditLogs/{logId}` -> DENIED.
