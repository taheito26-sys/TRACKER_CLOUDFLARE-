# merchant-api is deprecated

Option A cutover makes `backend/` the only production API.

This folder is retained temporarily for reference only.
Do not deploy it.
Do not point the frontend to it.
Do not treat `p2p-merchant-db` as canonical.

Retirement checklist:
1. Migrate or reconcile any still-needed data into the canonical backend database.
2. Confirm frontend no longer references merchant-api.
3. Confirm backend handles all merchant read and write flows.
4. Delete this folder after production verification is complete.
