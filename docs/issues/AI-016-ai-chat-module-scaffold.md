---
id: AI-016
title: AiChatModule scaffold — enums, constants, empty service shells
type: AFK
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-06
started_at: 2026-07-06
completed_at: 2026-07-06
parent_epic: Epic 1 — Database Schema Extension
parent_prd: 2026-07-06-chat-streaming-function-calling.md
blocked_by:
  - AI-015
---

# What to Build

Scaffold the `AiChatModule` in the existing (currently empty, `.gitkeep`-only) `src/modules/ai-chat/` folder, following the exact structural pattern `OpenaiModule` uses: a module class, a `constants/` barrel, empty service class shells (implemented in later issues), and DI registration in `AppModule`.

**Module**: `AiChatModule` imports `OpenaiModule` (for `OpenaiService`, `TokenService`, `ModelRegistryService`) and exports `ChatService` (the only public surface other modules would need, matching `OpenaiModule`'s "only export what's needed externally" convention). Register the four services (`ChatService`, `StreamingService`, `ToolRegistryService`, `ToolExecutorService`) and one controller (`ChatController` — implemented starting AI-031) as providers.

**Enums** (in `constants/`, each its own file + re-exported from a barrel `index.ts`, matching `openai/constants/`):

```typescript
export enum ChatMessageRole {
  SYSTEM = 'system',
  USER = 'user',
  ASSISTANT = 'assistant',
  TOOL = 'tool',
}

export enum ToolHandlerType {
  BUILTIN = 'builtin',
  HTTP = 'http',
}

export enum StreamEventType {
  TOKEN = 'token',
  TOOL_CALL = 'tool_call',
  TOOL_RESULT = 'tool_result',
  DONE = 'done',
  ERROR = 'error',
}

export enum ConversationStatus {
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}
```

**Constant**:

```typescript
export const CONTEXT_CONFIG = {
  maxMessages: 50,
  contextWindowPercentage: 0.8,
  defaultContextWindow: 128000,
} as const;
```

Note: these numeric defaults should actually be read from the `chatConfig` namespace (AI-015) at the call site in `ChatService`, not hardcoded — `CONTEXT_CONFIG` here is only a fallback constant for cases where config isn't injected (e.g. a pure utility function), matching how `RETRY_CONFIG` in the OpenAI module is used as a fallback alongside `ConfigService` reads in `RetryService`.

**Empty service shells**: `ChatService`, `StreamingService`, `ToolRegistryService`, `ToolExecutorService` — each a bare `@Injectable()` class with constructor-injected dependencies (`DatabaseService`, `AppLoggerService`, `ConfigService`, and cross-service injections like `ChatService` injecting `OpenaiService`/`TokenService`/`ModelRegistryService`) but no method bodies yet beyond what's needed to compile (throw `Error('not implemented')` or leave methods absent — whichever keeps `tsc` clean; prefer leaving methods absent since TypeScript won't complain about a class with only a constructor).

**Types** (in `types/ai-chat.types.ts`, matching `openai/types/`): define at minimum `ChatMessageEntity`, `ConversationEntity`, `ToolEntity` describing the DB-row shapes these services will pass around (all fields except any internal-only ones), and `StreamEvent`/`ToolCallData`/`ToolExecutionResult` interfaces exactly as specified in spec §5.2/§5.4.

**Register `AiChatModule`** in `AppModule.imports`, next to `OpenaiModule`.

# User Stories Covered

- Foundation for all Epic 3–6 stories — no story directly maps to scaffolding alone.

# Acceptance Criteria

- [x] `AiChatModule` exists, imports `OpenaiModule`, exports `ChatService`
- [x] `AiChatModule` registered in `AppModule.imports`
- [x] All four enums exist in `constants/`, re-exported from a barrel `index.ts`
- [x] `CONTEXT_CONFIG` constant exists with the three documented fields
- [x] `ChatMessageEntity`, `ConversationEntity`, `ToolEntity`, `StreamEvent`, `ToolCallData`, `ToolExecutionResult` types exist in `types/`
- [x] Four service shells (`ChatService`, `StreamingService`, `ToolRegistryService`, `ToolExecutorService`) exist as injectable classes with correct constructor dependencies
- [x] `npx tsc --noEmit --project tsconfig.build.json` passes with zero errors
- [x] App boots successfully (`npm run dev`) with the new module wired in — no DI resolution errors

## Implementation Notes

Scaffolded `src/modules/ai-chat/` mirroring `OpenaiModule`'s structure exactly:

- **`constants/`** — `chat-message-role.enum.ts`, `tool-handler-type.enum.ts`,
  `stream-event-type.enum.ts`, `conversation-status.enum.ts` (one enum per file, per spec §4) and
  `context-config.constant.ts` (`CONTEXT_CONFIG`), all re-exported from `constants/index.ts`.
- **`types/ai-chat.types.ts`** — `ConversationEntity`, `ChatMessageEntity`, `ToolEntity` (DB-row
  shapes mirroring the `chat_conversations`/`chat_messages`/`chat_tools` columns from AI-015),
  plus `ToolCallData`, `StreamEvent`, `ToolExecutionResult` exactly as specified in spec §5.2/§5.4.
- **`services/`** — four empty `@Injectable()` shells (`ChatService`, `StreamingService`,
  `ToolRegistryService`, `ToolExecutorService`), each with a constructor only (no method bodies).
  `ChatService` additionally injects `OpenaiService`, `TokenService`, `ModelRegistryService` from
  `OpenaiModule` (all already exported by that module from Phase 1) since it's the orchestrator
  that will call into them starting AI-018/AI-022. The other three get the baseline
  `DatabaseService`/`AppLoggerService`/`ConfigService` trio; their real dependencies (e.g.
  `HttpModule` for `ToolExecutorService`'s HTTP-handler tools) will be added when their method
  bodies land in AI-023–AI-026.
- **`ai-chat.module.ts`** — imports `OpenaiModule`, registers the four services as providers,
  exports only `ChatService` (matching the "only export what's needed externally" convention). No
  controller is registered yet — despite the issue's "What to Build" text mentioning one, the
  acceptance criteria and the issue's own note ("ChatController — implemented starting AI-031")
  confirm the controller is out of scope here; AI-031 will add `controllers: [ChatController]`.
- Registered `AiChatModule` in `AppModule.imports`, next to `OpenaiModule`. Removed the
  `src/modules/ai-chat/.gitkeep` placeholder now that the folder has real content.

Verified `AiChatModule` → `OpenaiModule` is one-directional (no circular dependency): boot log
shows `AiChatModule dependencies initialized` and `OpenaiModule dependencies initialized` with no
DI resolution errors.

## Validation Performed

- `npx tsc --noEmit --project tsconfig.build.json` — passes, zero errors
- `npm run lint:check` — 0 errors, 29 pre-existing warnings (unchanged, none in `ai-chat/`)
- `npm run build` — succeeds
- `node dist/src/main.js` (compiled boot, since `npm run dev` runs a persistent watcher) — app
  starts successfully, all routes mapped, `AiChatModule dependencies initialized` and
  `OpenaiModule dependencies initialized` logged with no DI errors
- `npm run test` — 114/114 pass (10/10 suites), no regressions

## Assumptions Made

- The "one controller (`ChatController`... ) as providers" line in "What to Build" is not acted on
  literally — controllers don't belong in a `providers` array, and the issue's own dependency note
  plus the acceptance criteria (which never mention a controller) confirm `ChatController` is
  AI-031's responsibility, not this issue's.
- Exact constructor dependencies for `StreamingService`, `ToolRegistryService`,
  `ToolExecutorService` weren't specified beyond "constructor-injected dependencies (DatabaseService,
  AppLoggerService, ConfigService, and cross-service injections like ChatService injecting...)" —
  interpreted as: all four get the baseline trio, and only `ChatService` gets the additional
  cross-service injections named in the issue text. Later issues (AI-023–AI-029) may add or adjust
  dependencies as method bodies are implemented.

## Follow Ups

- AI-017 (seed built-in tools) and AI-019 (ChatService conversation CRUD) are now unblocked.
- `ToolExecutorService` will likely need `HttpModule` imported into `AiChatModule` once AI-026
  implements the `'http'` handler type.

# Dependencies

- AI-015 — schema must exist so entity types can accurately mirror DB row shapes

# Testing Notes

No unit tests for empty shells. Verification is: app boots (`npm run dev`, check logs for DI errors), `tsc --noEmit` passes, and the module import graph in `AppModule` resolves without circular-dependency warnings (watch for `AiChatModule` ↔ `OpenaiModule` — this should be one-directional, `AiChatModule` imports `OpenaiModule`, never the reverse).
