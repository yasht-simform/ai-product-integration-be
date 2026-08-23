---
name: implement-next
description: Select the next implementation slice from local issue artifacts and implement exactly one issue at a time. Use when continuing development after issue generation.
---

# Implement Next

Implement exactly ONE issue at a time from `docs/issues/`.

The goal of this skill is disciplined, dependency-aware execution with small, mergeable increments.

Never work on multiple issues simultaneously.

## Issue Status Lifecycle

```text
ready-for-agent
↓
in-progress
↓
in-review
↓
completed
```

Additional status:

```text
blocked
```

Only issues with `ready-for-agent` status are eligible for selection.

## Process

### 1. Gather Context

Read only the minimum required context.

Load:

- `docs/issues/index.md`
- candidate issue files from `docs/issues/*.md`
- referenced PRDs from `docs/prd/`
- requirement specifications from `docs/specs/`
- `CLAUDE.md` for project conventions and existing module documentation
- `prisma/schema.prisma` for current database state
- relevant existing modules in `src/modules/` for patterns to follow

Avoid broad repository scans.

Goal:

- understand current execution state
- understand dependency graph
- understand feature intent from requirement spec
- understand existing NestJS architecture patterns (module, service, controller, DTO, test)
- understand existing test patterns (jest-mock-extended, spec file location, mock setup)

---

### 2. Build Dependency Graph

Construct issue relationships using:

```yaml
blocked_by:
```

Determine:

- which issues are completed
- which issues remain blocked
- which issues are executable now

Eligible issues MUST:

- have `status: ready-for-agent`
- have all dependencies completed
- not already be assigned
- not be blocked
- belong to active work

Exclude:

- completed issues
- in-review issues
- blocked issues
- abandoned issues
- already assigned issues

---

### 3. Prioritize Candidate Issues

Prioritize using this order:

1. Dependency blockers (issues that unblock the most downstream work)
2. Priority (`P1 > P2`)
3. Lower implementation complexity
4. Lower issue number
5. Better isolation / lower merge risk

If prioritization remains ambiguous:

- briefly explain choices
- pick the safest incremental option

---

### 4. Select Exactly ONE Issue

Pick a single issue.

Immediately update metadata:

```yaml
status: in-progress
assigned_to: Claude
started_at: YYYY-MM-DD
```

Never pick multiple issues.

Never partially start another issue.

Output:

- selected issue
- why it was selected
- dependencies satisfied
- expected scope

---

### 5. Build an Implementation Plan

Before changing code:

Identify:

- affected modules/services in `src/modules/`
- existing patterns to reuse (check similar services, DTOs, tests)
- tests to create (follow `*.spec.ts` co-location pattern)
- Prisma schema changes needed
- new dependencies to install
- barrel exports to update (`index.ts` files)
- `app.module.ts` imports to update
- `CLAUDE.md` updates needed

Create a concise implementation plan.

Prefer:

- minimal safe changes
- reuse existing patterns (copy structure from similar modules)
- NestJS conventions (decorators, dependency injection, module exports)
- class-validator for DTOs, @nestjs/swagger for API docs
- incremental delivery

Avoid:

- unnecessary refactors of existing code
- unrelated cleanup
- speculative architecture changes
- touching modules outside the issue scope

---

### 6. Implement

Perform implementation.

Rules:

- follow NestJS and project conventions from `CLAUDE.md`
- use class-validator decorators on all DTOs
- use @nestjs/swagger decorators on all endpoints and DTOs
- use LoggerService — no console.\*
- use ConfigService — no process.env
- no `any` types (TypeScript strict)
- preserve backward compatibility
- use existing abstractions first (PrismaService, existing base DTOs)
- prefer smallest safe change set
- avoid touching unrelated files
- create barrel exports (`index.ts`) for new directories

Continuously validate assumptions while implementing.

If implementation reveals missing information:

- pause only for truly blocking uncertainty
- otherwise make reasonable documented assumptions
- note assumptions in the Implementation Notes section

---

### 7. Validate

Run appropriate validation in this order:

1. `npx tsc --noEmit` — TypeScript compilation
2. `npm run lint` — ESLint passes
3. `npm run build` — build succeeds
4. `npm run test -- <module-name>` — targeted tests pass
5. `npm run test` — full test suite passes (no regressions)

If failures occur:

- fix if clearly related to this issue
- document if unrelated (pre-existing failures)

---

### 8. Update Issue Artifact

Update issue metadata:

```yaml
status: completed
assigned_to: Claude
completed_at: YYYY-MM-DD
```

Add:

```md
## Implementation Notes

Summary of what was built: files created/modified, key design decisions, patterns followed.

## Validation Performed

- `npx tsc --noEmit` — result
- `npm run lint` — result
- `npm run build` — result
- `npm run test -- <module>` — X/X pass
- `npm run test` — X/X pass (full suite)

## Assumptions Made

Document any implementation assumptions not covered by the spec.

## Follow Ups

Optional future improvements or deferred decisions.
```

Also update:

- `docs/issues/index.md` — mark issue as completed
- `CLAUDE.md` — add new module/service/endpoint documentation
- related PRD tracking section if necessary

---

### PRD Status Check

After marking an issue completed, check if ALL issues belonging to the same `parent_prd` are now `completed`.
If yes:

- Update the PRD file's frontmatter: `status: completed`
- Update `docs/prd/index.md`: change that PRD's status to `completed`
- Log: "All issues for [PRD title] are completed — PRD marked as completed"

If not, do nothing — the PRD stays `ready-for-agent` until every issue is done.

---

### 9. Recommend Next Issue

Identify the next executable issue.

Output:

- recommended next issue
- why it is next
- newly unblocked issues
- remaining issue count

Do NOT automatically begin the next issue.

Stop after completing one issue.

---

## Selection Rules

Always prefer:

- AFK issues over HITL issues
- complete slices over infrastructure-only work
- smaller vertical slices
- independently mergeable work
- reversible changes
- issues that unblock the most downstream work

Avoid:

- parallel execution
- hidden dependency chains
- cross-cutting refactors
- implementing future phase work early

---

## Failure Handling

If no executable issue exists:

Explain why.

Possible reasons:

- dependency blocked
- all work completed
- waiting on HITL issue (e.g., API key configuration, live API testing)
- missing spec information

Provide recommended next action.

---

## Expected Issue Metadata

Expected issue header:

```yaml
---
id: AI-001
title: Prisma schema for ai_audit_logs and prompt_templates
type: AFK
status: ready-for-agent
priority: P1
assigned_to: null
created: YYYY-MM-DD
parent_epic: Infrastructure
parent_prd: 2026-06-25-openai-api-foundations.md
blocked_by: []
---
```

Expected statuses:

```text
ready-for-agent
in-progress
blocked
in-review
completed
```

Expected priorities:

```text
P1
P2
```

---

## Success Criteria

A successful execution means:

- one issue selected
- one issue completed
- `npx tsc --noEmit` passes
- `npm run build` passes
- `npm run test` passes (or pre-existing failures documented)
- artifacts updated (issue, index, CLAUDE.md)
- next work identified

No more than one issue should be completed per execution.
