---
name: to-prd
description: Turn a requirement specification into a PRD and save it locally. Use when user wants to create a PRD from a spec document or conversation context.
---

# To PRD

Convert a requirement specification or conversation context into a structured PRD.

Generated PRDs are stored locally under `docs/prd/`.

## Process

1. Explore the repository to understand the current state of the codebase.
   - Read only the minimum necessary files to understand architecture and domain terminology.
   - Check existing modules in `src/modules/` for patterns to follow.
   - Read `CLAUDE.md` for project conventions and existing module documentation.
   - Reuse existing architecture patterns (DTOs, services, modules, barrel exports).
   - Avoid broad repository scans when targeted exploration is sufficient.

2. Understand feature scope from:
   - Current conversation context
   - Requirement specification documents in `docs/specs/`
   - The original goal document (`G3_AI_Product_Integration.pdf`)
   - Existing repository structure and NestJS module patterns
   - Existing naming conventions (kebab-case files, PascalCase classes)

3. Sketch out the seams at which the feature will be tested.
   - Prefer existing seams over new seams.
   - Use the highest-level seam possible (service-level unit tests, controller-level integration tests).
   - Follow existing test patterns: `jest-mock-extended` for Prisma mocks, `*.spec.ts` co-located with source.
   - Only ask for clarification if seam decisions materially impact architecture.

4. Determine a PRD filename.
   - Use kebab-case.
   - Format: `YYYY-MM-DD-short-feature-name.md`
   - Example: `2026-06-25-openai-api-foundations.md`

5. Create the PRD in `docs/prd/<filename>` using the template below.

6. Create or update `docs/prd/index.md`.
   - Add a new entry for the PRD.
   - Keep newest entries first.
   - Preserve existing entries.

7. Mark all newly created PRDs with status `ready-for-agent`.

8. Output:
   - Created file path
   - Updated files
   - Important assumptions made
   - Suggested next step

## PRD Metadata Header

Every PRD must begin with:

```yaml
---
title: <PRD title>
status: ready-for-agent
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
phase: <Phase number from AI Product Integration plan>
tags:
  - feature-area
  - subsystem
authors:
  - Yash Trivedi
---
```

<prd-template>

# <Feature Name>

## Problem Statement

Describe the problem from the developer's learning perspective AND the system's technical perspective.

Focus on:

- What capability is missing
- Why this matters for the AI Product Integration goal
- What the developer will learn by building this
- Technical gaps in the current system

## Solution

Describe the solution from the system's perspective.

Focus on:

- Module architecture
- Service responsibilities
- Data flow
- How this integrates with existing NestJS modules

## Epic Breakdown

Organize the work into logical epics.

Rules:

- Prefer 3–7 epics for medium features
- Organize by capability boundaries (Infrastructure → Core Logic → API Layer → Tests)
- Follow the dependency pattern from the requirement spec
- Each epic should map to a testable vertical slice

Format:

### Epic X: <Epic Name>

**Goal**

Describe what this epic accomplishes.

**Stories Included**

- Story reference(s)

**Dependencies**

- Internal dependencies (other epics in this PRD)
- External dependencies (existing modules like DatabaseModule, ConfigModule)

**Risks**

- Delivery risks
- Technical risks (tiktoken WASM memory, OpenAI rate limits)

**Success Criteria**

- Observable outcomes
- Test coverage outcomes

## User Stories

Create an extensive numbered list.

Format:

1. As a <actor>, I want <feature>, so that <benefit>

Cover:

- Happy paths (successful API calls, correct token counts)
- Failure scenarios (API key missing, rate limited, circuit open)
- Edge cases (empty prompts, max token limits, unknown models)
- Cost tracking scenarios
- Retry and circuit breaker scenarios
- Prompt template management
- Audit log querying
- Model comparison scenarios
- Performance concerns (tiktoken memory, audit log latency)

## Implementation Decisions

Document stable technical decisions.

Include:

- NestJS module structure
- Service boundaries and responsibilities
- Database schema decisions
- API contract design
- Error handling strategy
- Retry and circuit breaker design
- Token counting approach
- Audit logging pattern (fire-and-forget vs synchronous)
- Environment variable design

Rules:

- Do NOT include file paths.
- Do NOT create implementation tasks.
- Focus on decisions likely to survive refactors.
- Reference the requirement specification for detailed specs.

## Testing Decisions

Document validation strategy.

Include:

- Unit test approach (jest-mock-extended for Prisma and OpenAI SDK mocks)
- Service-level testing seams
- Controller-level testing approach
- How to mock OpenAI API responses
- How to test retry logic and circuit breaker
- How to test token counting without real API calls
- Integration testing needs
- Regression risks to existing modules

## Out of Scope

Reference the requirement specification's "Out of Scope" section. Restate key exclusions.

## Further Notes

Document:

- Assumptions about existing codebase
- Risks specific to OpenAI API integration
- Dependencies on external services (OpenAI API availability)
- Future phase considerations

## Tracking

Status: ready-for-agent

Dependencies:

- List dependencies on existing modules

Open Questions:

- List any unresolved questions

Related PRDs:

- List related PRDs if any

</prd-template>

## Index Format (`docs/prd/index.md`)

```md
# PRD Index

| Date       | Title                  | Phase   | Status          | File                                   |
| ---------- | ---------------------- | ------- | --------------- | -------------------------------------- |
| 2026-06-25 | OpenAI API Foundations | Phase 1 | ready-for-agent | ./2026-06-25-openai-api-foundations.md |
```

Rules:

- Keep newest entries first.
- Preserve history.
- Create index if missing.
