# Capstone: Knowledge Base Q&A — Full Integration Specification

**For**: Engineering team (L&D — G3 AI Product Integration)
**Created**: 2026-07-10
**Status**: Draft
**Goal Document**: `G3_AI_Product_Integration.pdf`
**Depends On**: All 4 phases completed

---

## 1. Overview

The capstone is NOT a new module — it's the proof that all 4 phases work together seamlessly as one product. The goal doc says: "Pick ONE app → Seed with data → Work through scopes → Follow practices → Share learnings." We pick **App 1: Knowledge Base Q&A** because it exercises every phase.

The capstone deliverables are:

1. **A production-ready demo dataset** — real, coherent documents (not faker lorem ipsum) with comprehensive Q&A test coverage
2. **An integration test suite** — automated tests proving all phases work together end-to-end
3. **A demo script** — step-by-step walkthrough showing the entire system to stakeholders
4. **Final documentation** — project completion report covering what was built, learned, and how to demo

This is NOT about writing new services or endpoints. Everything exists. This is about proving it works together and packaging it for presentation.

---

## 2. What Already Exists (From Phases 1-4)

| Capability                                              | Phase       | Where                              |
| ------------------------------------------------------- | ----------- | ---------------------------------- |
| AI API calls with retry, circuit breaker, audit logging | Phase 1     | OpenaiModule                       |
| Token counting and cost tracking                        | Phase 1     | TokenService, AiAuditService       |
| Prompt templates (6 techniques)                         | Phase 1     | PromptTemplateService              |
| 340+ models via OpenRouter auto-sync                    | Enhancement | ModelRegistryService               |
| Multi-turn chat with persistent history                 | Phase 2     | AiChatModule, ChatService          |
| SSE streaming (word-by-word responses)                  | Phase 2     | StreamingService                   |
| Function calling (calculator, weather, datetime)        | Phase 2     | ToolExecutorService                |
| Document upload, chunking, embedding                    | Phase 3     | DocumentService, EmbeddingService  |
| Pinecone vector storage and semantic search             | Phase 3     | PineconeService, SearchService     |
| RAG Q&A with citations                                  | Phase 3     | RagService                         |
| RAG within conversations                                | Phase 3     | RagService.queryWithConversation() |
| Mock data generation                                    | Phase 3     | MockDataService                    |
| Evaluation pipeline (accuracy scoring)                  | Phase 3     | MockDataService + RagService       |
| Content moderation (input guard + output interceptor)   | Phase 4     | ModerationModule                   |
| Per-user cost budgets with enforcement                  | Phase 4     | CostManagementModule               |
| Cost analytics (by user, model, feature, timeline)      | Phase 4     | CostAnalyticsService               |
| Data retention (automated cleanup)                      | Phase 4     | RetentionService                   |

---

## 3. Deliverable 1: Production Demo Dataset

### 3.1 Documents (Already have 10 CloudPulse docs from Phase 3 realistic seed)

Extend to 50 total documents covering all 5 categories:

| Category  | Count | Content                                                                              |
| --------- | ----- | ------------------------------------------------------------------------------------ |
| guide     | 10    | Installation, configuration, deployment, migration, performance tuning guides        |
| faq       | 10    | Product FAQs, billing FAQs, technical FAQs, security FAQs                            |
| docs      | 10    | API reference, architecture overview, data model, webhooks, SDK reference            |
| tutorial  | 10    | Step-by-step tutorials: getting started, advanced features, integrations, automation |
| changelog | 10    | Monthly changelogs from Jan-Oct 2026 with features, fixes, breaking changes          |

Each document: 500-2000 words, coherent English about "CloudPulse" (fictional SaaS), structured with headings, code blocks where appropriate, specific facts/numbers/dates.

### 3.2 Q&A Test Pairs (250 total)

For each of 50 documents, create 5 Q&A pairs:

- 3 simple (150 total): "What port does CloudPulse run on?" → direct answer from one chunk
- 1 multi-step (50 total): "Compare free vs enterprise rate limits and explain which plan suits a startup" → needs multiple chunks
- 1 edge case (50 total): "Can I use CloudPulse with a database that doesn't support ACID?" → may not be answerable

### 3.3 Seed Script

A single command that:

1. Seeds all 50 documents
2. Waits for all embeddings to complete
3. Seeds Q&A pairs for evaluation
4. Seeds sample conversations (2-3 demo conversations with multi-turn history)
5. Seeds sample budgets (3 users with different limits)
6. Runs evaluation and prints accuracy report
7. Prints summary: "Demo dataset ready: 50 docs, X chunks, Y vectors, 250 Q&A pairs, 3 conversations, 3 budgets"

Command: `POST /api/v1/capstone/seed`

---

## 4. Deliverable 2: Integration Test Suite

Automated tests proving cross-phase integration:

### Test 1: Full RAG Flow with Moderation

1. Enable moderation
2. Upload a document
3. Ask a clean question → get RAG answer with citations
4. Ask a flagged question → get 422 (never reaches RAG)
5. Verify: audit logs show both the embedding call and the completion call. Moderation log shows the blocked input.

### Test 2: Chat + RAG + Tools + Streaming

1. Create a conversation with tools enabled
2. Send a RAG question (document-grounded) → answer with citations
3. Send a math question → calculator tool called
4. Send a follow-up referencing the RAG answer → conversation context maintained
5. Stream a response → verify token events arrive
6. Verify: all calls audited, conversation has correct message sequence

### Test 3: Cost Budget Enforcement

1. Create a budget: $0.001 daily limit
2. Make AI calls until budget exceeded
3. Next call → 429 with spend details
4. Verify: audit log shows the successful calls, budget status shows exceeded

### Test 4: Data Retention Safety

1. Create test data: old audit logs, old moderation logs, archived conversations
2. Create current data: recent audit logs, active conversations
3. Trigger cleanup
4. Verify: old data deleted, current data preserved, active conversations untouched

### Test 5: End-to-End Evaluation

1. Seed realistic dataset
2. Run evaluation
3. Assert: simple accuracy > 70%, overall > 50%
4. Verify: all evaluation queries generated audit log entries

---

## 5. Deliverable 3: Demo Script

A step-by-step guide for demoing the entire system to stakeholders (team, manager, or external reviewers). This is a markdown file that walks through a live demo.

### Demo Flow (15-20 minutes)

**Opening (2 min):**

- Show the Dashboard — stat cards, model count, system health
- "This is a full AI integration platform built with NestJS, covering 5 learning areas from the G3 goal"

**Act 1: Knowledge Base (4 min):**

- Show Knowledge Base → Documents tab → 50 documents loaded
- Upload a new document (paste some text)
- Watch embedding status go from pending → completed
- Switch to Q&A tab → ask "What is CloudPulse's return policy?"
- Show the RAG answer with citations — point out similarity scores
- "This is RAG — Retrieval Augmented Generation. The AI found the relevant document, read it, and answered with a citation."

**Act 2: Chat & Streaming (4 min):**

- Go to Chat → create new conversation
- Type a message → watch streaming response appear word-by-word
- "This is SSE streaming — same technology ChatGPT uses"
- Enable tools → ask "What's 15% of 2499?"
- Show the tool call card → calculator runs → synthesized answer
- Ask "What's the weather in Ahmedabad?"
- Show the weather tool calling a real API → answer with live data
- "Function calling — the AI decides when to use tools, executes them, and synthesizes the result"

**Act 3: Safety & Governance (3 min):**

- Go to Moderation page → test some text → show category scores
- Go to Cost Management → show budgets → show analytics charts
- Show projected monthly spend
- "Every AI call is audited, budgeted, and moderation-checked"

**Act 4: Model Registry & Pricing (2 min):**

- Show Models page → 340+ models from 56 providers
- Show Pricing page → cost calculator
- "We auto-sync from OpenRouter and support any OpenAI-compatible provider"

**Act 5: Under the Hood (3 min):**

- Show Audit Logs → filter by model, status
- Show Glossary → walk through key concepts
- Show the evaluation results → accuracy breakdown
- "Everything is observable, testable, and documented"

**Closing (2 min):**

- Show the Dashboard one more time
- Summarize: "75 issues, 705 tests, 4 phases, all 5 learning areas from the goal doc covered"

---

## 6. Deliverable 4: Project Completion Report

A final document summarizing the entire project:

### Structure

1. **Executive Summary** — one paragraph: what was built, why, key outcomes
2. **Goal Alignment** — table mapping every goal doc item to what was implemented
3. **Architecture** — high-level diagram of all modules and how they connect
4. **Phase Summary** — for each phase: what was built, issues count, test count, key learnings
5. **Technical Stats** — total endpoints, services, tables, tests, lines of code
6. **Tools & Technologies Used** — every tool from the goal doc + extras, with notes
7. **Key Practices Followed** — the 5 practices from the goal doc, how each was implemented
8. **Practice Apps** — all 3 apps, implementation status
9. **What I Learned** — personal reflection (template for you to fill in)
10. **Demo Instructions** — how to set up and run the demo
11. **Future Enhancements** — what could be added next (Azure, WebSocket, fine-tuning, etc.)

---

## 7. API Endpoints (New — Capstone Only)

Minimal new endpoints — just for seeding and demo:

```
POST /api/v1/capstone/seed              — Seed the full demo dataset (50 docs + Q&A + conversations + budgets)
POST /api/v1/capstone/reset             — Clean all demo data (start fresh)
GET  /api/v1/capstone/status            — Demo readiness check (docs count, vectors, evaluation score)
POST /api/v1/capstone/run-evaluation    — Run full evaluation and return report
```

---

## 8. Implementation Approach

This is NOT a full spec-to-PRD-to-issues pipeline. It's a focused deliverable:

### BE Work:

1. Create `src/modules/capstone/` with CapstoneService and CapstoneController
2. Extend the realistic seed data from 10 to 50 documents
3. Create 250 Q&A pairs (5 per document)
4. Build the 4 capstone endpoints
5. Create integration tests (5 test scenarios above)
6. Create the demo script markdown
7. Create the project completion report markdown

### FE Work:

1. No new pages needed — all 12 existing pages cover the demo
2. Optional: add a "Demo Mode" banner/button on the dashboard that links to the demo script
3. Run Playwright verification to confirm everything works together

---

## 9. What This Proves

When the capstone is complete, you can demonstrate:

| Goal Doc Requirement               | Proof                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| OpenAI API Basics                  | 13 Phase 1 endpoints, retry engine, circuit breaker                                   |
| LLM Integration Patterns           | Chat + streaming + function calling (3 tools)                                         |
| Prompt Engineering                 | 6 seed templates, prompt test endpoint                                                |
| Vector Search & RAG                | 50 documents, Pinecone search, RAG with citations, 70%+ accuracy                      |
| Safety & Compliance                | Moderation (guard + interceptor), budgets (429 enforcement), retention (cron cleanup) |
| Practice App 1: Knowledge Base Q&A | Full RAG pipeline with evaluation                                                     |
| Practice App 2: AI Chat Assistant  | Multi-turn chat with streaming and tools                                              |
| Practice App 3: Content Moderation | Moderation tester, logs, stats                                                        |
| Tools: OpenAI SDK                  | ✅                                                                                    |
| Tools: Pinecone                    | ✅                                                                                    |
| Tools: LangChain                   | ✅ (document loading + text splitting)                                                |
| Tools: OpenRouter                  | ✅ (340+ models auto-synced)                                                          |
| Mock Data                          | 50 docs + 250 Q&A pairs via faker + hand-written                                      |
| Key Practices (all 5)              | ✅ System prompts, backoff, test variations, log everything, cache embeddings         |

**100% of the goal document is covered.**
