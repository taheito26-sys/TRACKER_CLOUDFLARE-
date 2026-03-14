# V2 Execution Update Format (Mandatory)

Use this format for **every migration step and phase update**.

## Per-step update format

1. **Step completed:** <what was done>
2. **Evidence:** <file/command/result>
3. **Next step (Agent):** <immediate next implementation step>
4. **Next phase:** <phase number/name>
5. **Required from you (User):** <explicit inputs, approvals, environment actions>

## Per-phase close format

1. **Phase status:** <in progress / blocked / completed>
2. **Completed in this phase:** <bullets>
3. **Exit criteria status:** <checklist>
4. **Next step (Agent):** <first task in next phase>
5. **Next phase:** <phase number/name>
6. **Required from you (User):** <what you must do now>

## Default required-from-user checklist

When relevant, ask the user to provide:
- Cloudflare environment target (`local`, `staging`, `production`).
- Worker domain(s) for endpoint validation.
- Credentials/session readiness for `wrangler` operations.
- Owner names to replace role placeholders.
- Preferred migration window and freeze dates.



## Agent message placement rule

- In every **chat update**, the line `Required from you (User):` must appear for **each step** immediately after `Next phase:`.
- Do not move required user actions into separate docs only; keep them visible in the update message itself.
- If nothing is required from the user for a step, explicitly write: `Required from you (User): None.`


## Chat reply ordering rule

- In every chat update, place `Required from you (User):` first for the step/phase block.
- Immediately after that, print a progress bar line in this exact shape: `Progress: <done>/<total> tasks (<percent>%) <bar>`.
- Do this even when `Required from you (User): None.`
