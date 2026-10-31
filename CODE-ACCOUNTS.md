# Code accounts — 2.3.4

- Registration codes have six characters, with at least one letter and one digit; ambiguous 0/1/I/O are excluded. Twenty invalid code submissions per 15 minutes per client address block further code submissions temporarily.
- New users register with one issued code, a case-insensitive login ID and a password. No email address is collected.
- Existing non-anonymous Firebase accounts created before 2026-10-31T05:25:01.087Z retain access. Linking is optional and retains the original Firebase UID, so no learning/pet documents are migrated or overwritten.
- Existing Google/email sign-in remains available. A new Google/email Firebase identity alone is not admitted by the server.
- Private Firestore collections: registration_codes (SHA-256 document keys), code_accounts (hashed ID keys, normalized ID, UID, salted scrypt hash, reset/version state), account_uids (UID to account index). The existing production rules permit only each user's own users/{uid}/... documents and deny all these top-level collections to clients.
- Password hashing: scrypt N=16384, r=8, p=5, 16 random salt bytes, 64 output bytes. Newly registered or changed passwords must be 6–12 characters. Existing longer passwords remain valid for login during compatibility migration, up to the previous 128-character limit. No plaintext password storage.
- The 10,000 preissued codes are generated using HMAC-SHA256 from REGISTRATION_CODE_SEED held only in Render secret environment configuration. Neither their plaintext values nor an offline-checkable manifest is published. The legacy manifest file is empty. The plaintext list and printing artifact are delivered privately outside this repository. Code claims and ID/UID reservations use one atomic Firestore commit with existence/update-time preconditions.
- Admin-only issue, import, lookup and reset endpoints use the existing verified admin identity. Reset creates a random 12-character, 24-hour temporary password, requires a new password, and increments the custom-session version to reject older custom sessions.
- Authenticated API access also checks admission and reset state. Public health and the separately protected news-generation endpoint retain their intended behavior.
- Client entry gates redirect signed-out visitors and reject newly created external Google accounts. GitHub Pages still distributes static source files publicly; hiding/redirecting the UI does not make those files private. Strict confidentiality of textbook files would require moving their delivery behind authenticated hosting.
- This release does not delete existing Google/email identities or email metadata. Such removal must follow successful account migration.

References:
https://firebase.google.com/docs/auth/admin/create-custom-tokens
https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
