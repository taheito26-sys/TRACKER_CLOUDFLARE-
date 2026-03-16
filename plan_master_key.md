# Implementation Brief: Master Key Migration

## 1. Database Wipe
1. Wipe `merchant_roles`
2. Wipe `merchant_invites` 
3. Wipe `merchant_profiles`
Wiping these existing profiles solves the immediate request to clean the database and unblocks the structural migration without encountering foreign key errors for existing old references.

## 2. Setting Email as Master Key (`backend/src/index.js`)
Currently, `POST /profile/ensure` builds profiles with a random internal `id` (`mrc_row_...`) and a visual searchable `merchant_id` (`MRC-XXX...`). Foreign keys across the DB reference `id` as the relational master key.

To satisfy the requirement that the master key in the merchant database strictly equals the user email ID:
1. Hardcode **`id`** to precisely the normalized `email`.
2. Hardcode **`merchant_id`** to the `email` (destroying any runtime generation of `MRC...` identifiers).
3. The atomic `INSERT OR IGNORE` payload looks like:

```javascript
      const newProfile = {
        id: email,                      // The absolute DB master key is now the Email ID
        user_id: user.userId,
        email: email,
        merchant_id: email,             // App-level referencing ID is now the Email ID
        nickname,
        display_name: displayName,
        // ... (rest of profile fields stay the same)
      };
```

This naturally forces SQLite, the frontend search, the API constraints, and all relationship tables to adopt the native `email` string as the one cohesive identifier linking merchants together (making `taheito26@gmail.com` explicitly act as the ID in the URL, DB rows, relationships, and user profile bounds).

## 3. Verification
Trigger a Profile `ensure` login from the frontend. Verify the DB creates a single generic row where `id`, `email`, and `merchant_id` are explicitly the user's email address. Ensure a clean environment.
