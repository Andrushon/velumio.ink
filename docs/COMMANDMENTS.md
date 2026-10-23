# VELUMIO COMMANDMENTS (THE CONSTITUTION)

1. **NO CODE WITHOUT CONTEXT:** Never write or modify code without checking ADRs (Architectural Decision Records) and RUNBOOK.
2. **SAFETY FIRST:** Never run database migrations or infrastructure changes without manual approval from the Human Lead (Andrey).
3. **GLOBAL BRANDING:** No geographic names (Riga, Latvia, etc.) in the code or UI. The brand is global.
4. **DESIGN INTEGRITY:** Follow the "Velumio Branding Architecture" (3-A for Print/Books, C1-C for Digital/App).
5. **KEEP IT CLEAN:** No "dirty" hacks. If you must use a shortcut, document it as a TODO in the code and notify the Human Lead.
6. **COMMUNICATE:** Before any major change to Docker, Traefik, or Database, explain the impact to the Human Lead.

# I18N (INTERNATIONALIZATION) RULES

- ALL strings in the UI must be stored in external translation files (JSON).
- NO HARDCODED TEXT in the code components.
- Default language is English.
- The system must dynamically detect browser language or allow manual switching.
- Language files must be easily expandable to support 30+ languages (e.g., Latvian, Russian, English, German, Spanish, etc.).

# INFRASTRUCTURE RUNBOOK

## EMERGENCY PROCEDURES
- If the server is down: Check Docker logs (`docker-compose logs -f`).
- If data is corrupted: DO NOT attempt to fix it alone. Alert the Human Lead.
- Rollback: Only perform after checking the latest snapshot/backup.

## DEPLOYMENT RULES
- Always check the `release_checklist.md` before pushing to production.
- Use `web-only` deploy for UI changes.
- Never deploy API changes without verifying database schema compatibility.

## SECRETS
- NEVER commit secrets, API keys, or passwords to Git. Use environment variables.

## ⚠️ KNOWN RISK — DB MIGRATIONS (requires Andrey's attention)
- `scripts/post-merge.sh` currently runs `drizzle-kit push` **automatically** on every task merge.
- This bypasses Commandment #2 (manual approval required).
- Until this is fixed: Andrey must review every merged task that touches `lib/db/src/schema/` before approving the merge.

# RELEASE CHECKLIST

- [ ] Does the change break existing UI?
- [ ] Is the 3D Seal of Authenticity rendering correctly?
- [ ] Are environment variables updated?
- [ ] Have you tested the feature on the staging environment?
- [ ] Does the Human Lead know what is being deployed?

# ARCHITECTURAL DECISION RECORDS (ADR)

- 2026-05-26: Global Branding Rule established (No location-based markers).
- 2026-05-26: Print-on-Demand uses photorealistic 3D rendering for the Seal of Authenticity (No physical dies needed).
- 2026-05-29: ETHNIC_VISUAL_HINTS in illustrations.ts must NOT use nationality names (e.g., "Latvian person") — use geographic-neutral descriptions ("Northern European Baltic person"). Commandment #3.
- 2026-05-29: Language-code-to-name maps (e.g., `lv: "Latvian"`) used in GPT prompts are functional locale data, NOT branding violations — they tell the AI which language to respond in.
- 2026-05-29: Branding Architecture spec (3-A / C1-C) must be documented by Human Lead in `docs/branding-architecture.md` before it can be enforced by agents.
