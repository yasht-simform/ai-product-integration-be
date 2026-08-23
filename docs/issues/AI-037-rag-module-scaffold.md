---
id: AI-037
title: RagModule scaffold — dependencies, enums, constants, empty service shells
type: AFK
status: completed
priority: P1
assigned_to: Claude
created: 2026-07-08
started_at: 2026-07-08
completed_at: 2026-07-08
parent_epic: Epic 1 — Database Schema & Configuration Foundation
parent_prd: 2026-07-08-vector-search-rag.md
blocked_by:
  - AI-036
---

# What to Build

Install the six new dependencies this phase needs: `@pinecone-database/pinecone`, `langchain`, `@langchain/openai`, `@langchain/community`, `pdf-parse`, `@faker-js/faker` (plus `@types/pdf-parse` if `pdf-parse` ships no bundled types).

Create `RagModule`, importing `OpenaiModule` (Phase 1) and `AiChatModule` (Phase 2) — never the OpenAI SDK, Pinecone SDK, or `DatabaseService` directly touched outside this module's own services. Register `RagModule` in `AppModule.imports`, next to `OpenaiModule`/`AiChatModule`.

Add the three `as const` object constants from spec §4.1–§4.3 exactly:

```typescript
export const DocumentSourceType = {
  PDF: 'pdf',
  TXT: 'txt',
  MD: 'md',
  GENERATED: 'generated',
} as const;
export const EmbeddingStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;
export const DocumentCategory = {
  GUIDE: 'guide',
  FAQ: 'faq',
  DOCS: 'docs',
  TUTORIAL: 'tutorial',
  CHANGELOG: 'changelog',
} as const;
```

Add the four hardcoded-default constants from spec §4.4–§4.7 (`CHUNKING_CONFIG`, `RAG_CONFIG`, `EMBEDDING_CONFIG`, `PINECONE_CONFIG`) as fallback constants — following `CONTEXT_CONFIG`'s precedent from Phase 2 (`CLAUDE.md`: "prefer reading config via `ConfigService` at call sites, falling back to this constant only where config isn't injected"). Services should generally read the tunable values (`chunkSize`, `topK`, etc.) from the new `ragConfig` namespace (AI-036) at call sites, with these constants serving as the literal defaults/non-tunable values (e.g. `RAG_CONFIG.systemPrompt`, `CHUNKING_CONFIG.separators`, `PINECONE_CONFIG.metric` — values with no corresponding env var).

Create seven `@Injectable()` service shells — `EmbeddingService`, `EmbeddingCacheService`, `DocumentService`, `PineconeService`, `SearchService`, `RagService`, `MockDataService` — each with only a constructor declaring its expected dependencies (`DatabaseService`, `ConfigService`, `AppLoggerService`, and cross-service injections like `OpenaiService`/`ChatService` where the architecture calls for them), no method bodies yet. Register all seven as `RagModule` providers.

Create a `RagController` stub with `@ApiTags('rag')`, registered in `RagModule.controllers`. Add `'rag'` to the tag list in `main.ts`'s `DocumentBuilder`, alongside the existing `openai`/`ai-chat` tags.

# User Stories Covered

Foundational — enables all Epic 2+ stories (module, dependency, and constant prerequisites).

# Acceptance Criteria

- [x] All six new npm dependencies installed and present in `package.json`
- [x] `RagModule` created, imports `OpenaiModule` + `AiChatModule`, registered in `AppModule.imports`
- [x] `DocumentSourceType`/`EmbeddingStatus`/`DocumentCategory` constants added matching spec §4.1–§4.3 exactly
- [x] `CHUNKING_CONFIG`/`RAG_CONFIG`/`EMBEDDING_CONFIG`/`PINECONE_CONFIG` constants added matching spec §4.4–§4.7
- [x] Seven service shells exist as `@Injectable()` classes with constructor-only bodies, registered as `RagModule` providers
- [x] `RagController` stub exists with `@ApiTags('rag')`, registered in `RagModule.controllers`
- [x] `'rag'` tag added to `main.ts`'s `DocumentBuilder` (already present from Phase 2 scaffolding — no change needed)
- [x] `npm install` completes cleanly, `npx tsc --noEmit --project tsconfig.build.json` passes, `npm run lint:check` passes

# Dependencies

- AI-036 (schema + `ragConfig`/`pineconeConfig` this scaffold wires into)

# Testing Notes

No unit tests for empty shells, matching AI-016's precedent — validated via `tsc`/`lint`/`build`/live-boot only.

## Implementation Notes

Installed all six dependencies (`npm install ... --legacy-peer-deps` — see Assumptions below for why `--legacy-peer-deps` was needed). `pdf-parse@2.4.5` ships its own bundled types (`dist/pdf-parse/cjs/index.d.cts`), so `@types/pdf-parse` was not needed.

`src/modules/rag/constants/` — one file per constant, barrel `index.ts`, matching `ai-chat/constants/`'s layout exactly. The three `as const` objects also export a derived union type (`export type X = (typeof X)[keyof typeof X]`) so they're usable as TypeScript types at call sites later, following the same pattern Phase 1/2's string-literal DB columns (`role`, `status`, etc.) end up needing.

`src/modules/rag/services/` — seven `@Injectable()` shells, constructor-only, wired per the PRD's module diagram: `EmbeddingService` → `OpenaiService`; `EmbeddingCacheService` → `DatabaseService`; `PineconeService` → `ConfigService` only (no DI token for the Pinecone client itself — per AI-040's issue text, it's the sole consumer so a factory-provider token would be unneeded indirection); `DocumentService` → `TokenService` + `EmbeddingService` + `EmbeddingCacheService` + `PineconeService`; `SearchService` → `EmbeddingService` + `EmbeddingCacheService` + `PineconeService`; `RagService` → `SearchService` + `OpenaiService` + `ChatService` (the one cross-phase injection, per spec §5.6's `queryWithConversation()`); `MockDataService` → `DocumentService` + `RagService`. `RagController` is a bare `@ApiTags('rag')` stub with no routes yet.

`RagModule` imports `OpenaiModule` + `AiChatModule`, registers all seven services as providers and `RagController` as its one controller; no `exports` yet since nothing outside the module needs any RAG service in this phase. Registered in `AppModule.imports` after `AiChatModule`. The `'rag'` Swagger tag in `main.ts` already existed (added ahead of time during Phase 2's scaffolding, alongside unused `embeddings`/`moderation` tags) — no `main.ts` change was needed for this issue.

**Regression caught and fixed**: installing the six new packages with `--legacy-peer-deps` silently dropped `axios` out of the dependency tree entirely — it had only ever been present as a hoisted transitive dependency (never a direct `package.json` entry), and npm's re-resolution during this install stopped hoisting it. `@nestjs/axios`'s `HttpModule`/`HttpService` (used by `WeatherTool` and `OpenRouterSyncService`) declare `axios` as a _peer_ dependency, which npm does not auto-install — so this would have been a silent runtime break (missing module) despite `tsc`/build succeeding. It surfaced first as a spike in ESLint's `no-unsafe-*` warnings (54 → 106) across files that don't even touch RAG, because TypeScript could no longer resolve `axios`'s types for `HttpService`'s generics. Fixed by adding `axios@^1.3.1` (matching `@nestjs/axios`'s peer range) as an explicit direct dependency — warnings dropped back to the 54-warning baseline and a live boot confirmed `RagModule dependencies initialized` with no `UnknownDependenciesException`.

## Validation Performed

- `npm install` (six new packages + `axios` fix) — completes cleanly
- `npx tsc --noEmit --project tsconfig.build.json` — passes, no errors
- `npm run lint:check` — 0 errors, 54 warnings (back at the pre-existing baseline after the `axios` fix; one new `prettier/prettier` error in `rag-config.constant.ts` was caught and auto-fixed via `eslint --fix`)
- `npm run build` — succeeds
- `npm run test` — 271/271 pass (21/21 suites), no regressions
- Live boot check: `node dist/src/main.js` — log confirms `[InstanceLoader] RagModule dependencies initialized` and `Application running on port 3000`, no DI errors

## Assumptions Made

- `npm install` needed `--legacy-peer-deps`: `@langchain/community` pulls in `@browserbasehq/stagehand` (an optional peer, for a browser-automation tool loader this project never uses) which requires `dotenv@^16.4.5`, conflicting with the project's already-installed `dotenv@^17.4.2`. `--legacy-peer-deps` was the standard, low-risk fix for an unrelated optional-peer conflict — the alternative (`--force`) is more aggressive and less predictable about what else it might silently override.
- `@langchain/community@1.1.29` logs its own deprecation notice on install (pointing to `langchain-ai/langchainjs-community` issue #61) — used anyway since it's explicitly named in the Phase 3 spec (§8.1, §19) as the source of `PDFLoader`; worth re-checking at AI-042 implementation time whether a non-deprecated replacement package exists by then.
- `PineconeService`'s constructor currently only injects `ConfigService`/`AppLoggerService` (no Pinecone client yet) — `AI-040` will add the actual `@pinecone-database/pinecone` client instantiation; this issue only needed the shell to exist for `DocumentService`/`SearchService` to declare their dependency on it.

## Follow Ups

- AI-040 should double check `pineconeConfig.apiKey`/`pineconeConfig.index` being `undefined` (now optional per AI-036) is handled with a clear guard when the Pinecone client is actually instantiated, per that issue's own acceptance criteria.
- Worth a periodic `npm ls axios` sanity check in any future dependency-install issue in this phase — the same silent-hoisting-drop risk could recur with other peer-dependency-only packages (e.g. if a future LangChain package adds a new optional peer).
