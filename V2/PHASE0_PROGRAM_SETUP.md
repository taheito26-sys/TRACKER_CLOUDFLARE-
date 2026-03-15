# Phase 0 Program Setup — Execution Artifacts

This file operationalizes **Phase 0 (Program Setup)** from the V2 migration plan.

## 1) Ownership Matrix

| Stream | Primary Owner | Backup Owner | Responsibilities |
|---|---|---|---|
| API/Worker | Taheito (API Owner) | Miki Sato (Platform Backup) | Endpoint rollout, auth enforcement, FIFO/KPI server migration |
| Data Migration | Ryo Tanaka (Data Owner) | Taheito (API Owner) | import mapping, reconciliation SQL, idempotency validation |
| Frontend Rewire | Aki Yamada (Frontend Owner) | Ken Ito (Fullstack Backup) | replace `localStorage` mutation paths with API client |
| QA & Validation | Emi Kobayashi (QA Owner) | Ryo Tanaka (Data Backup) | parity tests, UAT scripts, release sign-off evidence |
| Release/Cutover | Daichi Suzuki (DevOps Owner) | Taheito (Product Owner) | staging/prod rollout windows, rollback execution, comms |

## 2) Delivery Milestones

- **M0 (Phase 0 close):** owner matrix + release/rollback checklists approved.
- **M1 (Phase 1 close):** D1 registry migration applied and system endpoints validated.
- **M2 (Phase 2-3):** auth hardening + import bridge completed in staging.
- **M3 (Phase 4-6):** core trading/deals/KPI APIs live and parity tested.
- **M4 (Phase 7-9):** frontend API-only cutover + localStorage decommission.

## 3) Release Checklist (Template)

- [ ] Scope and phase included in release note.
- [ ] Migration SQL files reviewed and idempotent.
- [ ] API contract changes documented.
- [ ] Feature flags/defaults documented.
- [ ] Validation commands prepared (health, migrations, smoke endpoints).
- [ ] Rollback plan attached and reviewed.

## 4) Rollback Checklist (Template)

- [ ] Rollback trigger conditions defined (error rate, parity drift, data mismatch).
- [ ] Previous Worker build/version reference recorded.
- [ ] DB rollback posture documented (forward-fix vs reversible migration).
- [ ] Feature-flag rollback command documented.
- [ ] Stakeholder comms template prepared.

## 5) Migration Window Controls

- Change freeze starts 24h before production cutover.
- No schema changes merged during freeze without migration owner approval.
- Reconciliation run is mandatory before cutover approval.

## 6) Communications Template

**Subject:** Tracker V2 Migration Window — <date/time>

- Scope: <phase/module>
- Expected impact: <none/degraded/full maintenance>
- Rollback condition: <criteria>
- Validation owner: <name>
- Go/No-Go decision time: <time>



## 7) Approval & Window Record

- Release checklist approval: **APPROVED** (rapid cutover directive).
- Rollback checklist approval: **APPROVED** (forward-fix posture accepted).
- Migration window: **Immediate cutover window opened**.
- Freeze dates: **Effective immediately until post-cutover stabilization closeout**.
- Risk posture: **Operator-directed fast-track execution; residual risk explicitly accepted**.
