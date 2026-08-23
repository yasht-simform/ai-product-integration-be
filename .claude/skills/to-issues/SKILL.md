---
name: to-issues
description: Break a PRD or requirement specification into independently executable implementation slices and store them locally. Use when user wants to convert requirements into implementation work items.
---

# To Issues

Break requirements into independently executable vertical slices.

Generated artifacts are stored locally under `docs/issues/`.

## Process

### 1. Gather context

Use:

- Current conversation context
- Requirement specification in `docs/specs/`
- Existing PRDs in `docs/prd/`
- Existing issue artifacts in `docs/issues/`
- `CLAUDE.md` for project conventions
- Referenced files provided by the user

If multiple PRDs exist, identify the relevant one.

### 2. Explore the codebase

If repository context is insufficient:

- Read `src/modules/` structure to understand existing patterns
- Check existing service, controller, DTO, and test patterns
- Read `prisma/schema.prisma` for current database state
- Reuse domain terminology from existing code
- Avoid broad repository scans

### 3. Draft vertical slices

Break work into tracer-bullet slices.

Rules:

- Deliver end-to-end behavior per slice
- Prefer thin slices (1 service method, 1 endpoint, or 1 test suite per issue)
- Avoid infrastructure-only slices where possible (schema + enum can be combined if small)
- Prefer independently mergeable work
- Prefer independently testable work
- Prefer 1–3 hour implementation size (this is a learning project, slices should be small)
- Use existing NestJS architecture seams (module → service → controller → DTO → test)
- Follow the dependency pattern seen in the reference project (EH-001 through EH-021):
  - Schema/migration first
  - Enums/constants second
  - Core service methods third
  - DTOs fourth
  - Query/read methods fifth
  - Unit tests for core service sixth
  - Feature instrumentation next
  - API endpoints next
  - Endpoint tests last

Slice types:

- AFK → Can be implemented autonomously by Claude Code
- HITL → Requires human decision/review (e.g., API key setup, manual testing against live API)

Each slice should contain:

- Title
- Type (AFK or HITL)
- Priority (P1 for critical path, P2 for tests and enhancements)
- Dependencies (blocked_by)
- Stories covered
- Goal
- Acceptance criteria
- Testing notes

### 4. Validate breakdown

Present slices first.

Only request feedback if:

- Dependencies are unclear
- Granularity uncertainty exists
- Major architecture assumptions exist

Otherwise proceed automatically.

### 5. Generate issue artifacts

Create:

`docs/issues/ISSUE-XXX-short-name.md`

Use sequential numbering. Prefix with project abbreviation:

- Phase 1 issues: `AI-001`, `AI-002`, etc.

Create/update:

`docs/issues/index.md`

Keep newest entries first.

Update parent PRD Tracking section with created issue references.

<issue-template>

---

id: AI-XXX
title: <title>
type: AFK
status: ready-for-agent
priority: P1
assigned_to: null
created: YYYY-MM-DD
parent_epic: <Epic name>
parent_prd: <filename>
blocked_by:

- AI-001

---

# What to Build

Describe the vertical slice.

Focus on:

- End-to-end behavior
- Service methods to implement
- How it integrates with existing modules
- Expected inputs and outputs

Avoid:

- Exact file paths (let the agent follow conventions)
- Task lists (describe behavior, not steps)
- Large code snippets (describe intent, not implementation)

Exception: Include code snippets for interfaces, type signatures, or enum values when they are part of the spec and must be implemented exactly.

# User Stories Covered

- Story X
- Story Y

# Acceptance Criteria

- [ ] Criteria 1
- [ ] Criteria 2
- [ ] Criteria 3

# Dependencies

List dependencies.

Or:

None — can start immediately.

# Testing Notes

Describe:

- Primary seam (service unit test, controller test, etc.)
- Expected validation strategy
- How to mock OpenAI SDK responses
- Important regression risks

**Manual testing prompts (include when the agent cannot verify alone):**

Rules:

- Default to automated testing — only add manual prompts when the agent cannot verify the outcome
- OpenAI API calls require a real API key — add manual prompts for live API verification
- Build/lint/type-check verification should always be automated
- Unit tests with mocked OpenAI responses should be automated

Example prompts:

Live API verification:

> "Could you run `curl -X POST http://localhost:3000/api/v1/openai/chat -H 'Content-Type: application/json' -d '{"prompt": "What is 2+2?"}'` and paste the response? I want to confirm the OpenAI integration works end-to-end with a real API key."

Cost tracking verification:

> "Could you run `curl http://localhost:3000/api/v1/openai/audit-logs/cost-summary` after sending a few chat completions and paste the response? I want to confirm costs are being tracked correctly."

Circuit breaker verification:

> "Could you check `GET /api/v1/openai/health` after the retry tests and confirm the circuit breaker state is reported correctly?"

</issue-template>

## Index Format

```md
# Issue Index — Phase 1: OpenAI API Foundations

## Parent PRD

`docs/prd/YYYY-MM-DD-openai-api-foundations.md`

## Issues

| ID     | Title                                                | Type | Priority | Status          | Epic           | Blocked By |
| ------ | ---------------------------------------------------- | ---- | -------- | --------------- | -------------- | ---------- |
| AI-001 | Prisma schema for ai_audit_logs and prompt_templates | AFK  | P1       | ready-for-agent | Infrastructure | —          |
```

Rules:

- Preserve history
- Keep newest first
- Never overwrite existing issue IDs
- Maintain references between PRDs and issues
- Group issues by epic in the table for readability
