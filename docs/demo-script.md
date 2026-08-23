# Demo Script: AI Product Integration Platform

A step-by-step walkthrough for demoing the entire system — chat, RAG, safety, cost governance,
and model registry — to stakeholders (team, manager, or external reviewers). Total runtime:
**15-20 minutes**.

## Before You Start

1. Make sure both servers are running:

   ```bash
   # Backend (from ai-product-integration-be/)
   npm run dev

   # Frontend (from ai-product-integration-fe/)
   npm run dev
   ```

2. Seed the demo dataset — one command, takes a few minutes (it's embedding 50 real documents
   and running a live evaluation):

   ```bash
   curl -X POST http://localhost:3000/api/v1/capstone/seed
   ```

   This gives you: 50 CloudPulse documents (fully embedded and searchable), 250 Q&A evaluation
   pairs, 3 sample multi-turn conversations, 3 sample cost budgets, and a live evaluation report
   — all printed in one summary.

3. Open the frontend at `http://localhost:5173`.

If you need to start over mid-demo (e.g. a document got into a bad state), reset and re-seed:

```bash
curl -X POST http://localhost:3000/api/v1/capstone/reset
curl -X POST http://localhost:3000/api/v1/capstone/seed
```

---

## Opening (2 min)

- Show the **Dashboard** (`/`) — stat cards (models, conversations, documents, audit logs),
  model count, system health indicator.
- **Say:** "This is a full AI integration platform built with NestJS, covering 5 learning areas
  from the G3 goal document: OpenAI API basics, LLM integration patterns, prompt engineering,
  vector search & RAG, and safety & compliance — plus the 3 practice apps the goal doc asks for."

---

## Act 1: Knowledge Base (4 min)

- Go to **Knowledge Base** (`/knowledge-base`) → **Documents** tab → point out **50 documents
  loaded**, spanning 5 categories (guide, FAQ, docs, tutorial, changelog) — all real, coherent
  CloudPulse (a fictional SaaS) documentation, not lorem-ipsum filler.
- Upload a new document: switch to the upload form, paste a short paragraph of text (e.g. "Our
  new mobile app supports offline mode and biometric login."), submit.
- Watch the embedding status go **pending → processing → completed** in real time (refresh the
  document list or its detail view).
- Switch to the **Q&A (RAG)** tab → ask: **"What is CloudPulse's return policy?"**
- Show the RAG answer with citations — point out the similarity scores on each cited source
  chunk.
- **Say:** "This is RAG — Retrieval Augmented Generation. The AI found the relevant document
  chunks in Pinecone, read them, and answered with a citation back to the source — it never
  hallucinated an answer from its own training data."

---

## Act 2: Chat & Streaming (4 min)

- Go to **Chat** (`/chat`) → **New Chat**.
- Type a message (e.g. "Explain what a REST API is in one sentence") → watch the streaming
  response appear **word-by-word**.
- **Say:** "This is SSE streaming — the same technology ChatGPT's own web UI uses."
- Enable **tools** on the conversation → ask: **"What's 15% of 2499?"**
- Show the tool-call card appearing in the chat — the calculator tool runs, then the model
  synthesizes a final answer from the result.
- Ask: **"What's the weather in Ahmedabad?"**
- Show the weather tool calling a real external API (Open-Meteo) → an answer with live
  current-conditions data.
- **Say:** "Function calling — the AI decides when it needs a tool, executes it, and
  synthesizes the tool's result into a natural-language answer. No manual tool selection."
- (Optional, if time allows) Open the **Q&A (RAG)** tab's demo conversation named
  `[Capstone Demo] Pricing Questions` — it already has multi-turn history showing a RAG-grounded
  question followed by a natural follow-up, proving conversation context carries across turns.

---

## Act 3: Safety & Governance (3 min)

- Go to **Moderation** (`/moderation`) → paste a borderline piece of text into the tester → show
  the category scores (violence, hate, self-harm, etc.) and the flagged/clean verdict.
- Switch to the **Moderation Logs** tab → show every check made through chat/RAG/the tester is
  logged here, filterable by direction and source.
- Go to **Cost Management** (`/cost`) → **Budgets** tab → show the 3 seeded demo budgets
  (`capstone-demo-alice`, `capstone-demo-bob`, `capstone-demo-carol`) with different daily/monthly
  limits and live spend bars.
- Switch to the **Analytics** tab → show the projected monthly spend card, and the spend-by-user/
  spend-by-model/spend-by-feature breakdowns.
- **Say:** "Every single AI call in this system — chat, RAG, embeddings — is audited, budgeted
  per user, and moderation-checked before and after. Nothing is a black box."

---

## Act 4: Model Registry & Pricing (2 min)

- Go to **Models** (`/models`) → show **340+ models from 56+ providers**, auto-synced daily from
  OpenRouter.
- Go to **Pricing** (`/pricing`) → use the cost calculator: pick a model, enter a token count,
  show the computed cost breakdown.
- **Say:** "We auto-sync the full model catalog from OpenRouter every day, and the same
  `OPENAI_CLIENT` factory works with any OpenAI-compatible provider — OpenRouter, Groq, Together
  AI, or real OpenAI — by changing one environment variable."

---

## Act 5: Under the Hood (3 min)

- Go to **Audit Logs** (`/audit-logs`) → filter by model or status → show a real request's full
  token/cost/latency breakdown.
- Go to **Retention** (`/retention`) → show the configured retention periods and the "Run Cleanup
  Now" button — explain that old audit logs, moderation logs, and archived conversations are
  cleaned up automatically on a daily cron, but active conversations are **never** touched
  regardless of age.
- Check the evaluation results from the seed step:

  ```bash
  curl http://localhost:3000/api/v1/capstone/status
  ```

  Point out the `lastEvaluation` block — accuracy broken down by question complexity (simple,
  multi-step, edge-case).

- Go to **Glossary** (`/glossary`) → walk through a couple of key concepts (RAG, function
  calling, circuit breaker) — show the progress bar at **100% of concepts implemented**.
- **Say:** "Everything here is observable, testable, and documented — 710 automated tests, and
  every non-obvious design decision is written down in the codebase's own context file, not just
  in someone's head."

---

## Closing (2 min)

- Show the **Dashboard** one more time.
- **Say:** "To summarize: 75 issues shipped across 4 phases, 710 automated tests, all 5 learning
  areas from the goal document covered, and all 3 practice apps — Knowledge Base Q&A, AI Chat
  Assistant, and Content Moderation — fully implemented and demoable end to end."

---

## Cleanup After the Demo

If this was a one-off demo on a shared/dev database, remove the demo data afterward:

```bash
curl -X POST http://localhost:3000/api/v1/capstone/reset
```

This deletes exactly the 50 demo documents (and their chunks, Q&A pairs, and Pinecone vectors),
the 3 demo conversations, and the 3 demo budgets — nothing else in the database is touched.

## Troubleshooting

| Symptom                                                                   | Likely cause                                                                                                                            | Fix                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /capstone/seed` returns 500 partway through                         | Transient Pinecone connectivity blip (a known, previously-documented sandbox/network flakiness — see `CLAUDE.md`'s AI-055/AI-075 notes) | Check `GET /capstone/status` — documents/chunks/Q&A/conversations/budgets usually seeded successfully even if the final evaluation step failed. Re-run `POST /capstone/run-evaluation` with a smaller `sampleSize` (e.g. 10-20) |
| Chat response is empty or very slow                                       | The configured free-tier OpenRouter model is rate-limited                                                                               | Override `model` per-request, or check `GET /openai/models/free` for a currently-live alternative                                                                                                                               |
| Weather tool times out                                                    | Real network latency to Open-Meteo from this environment                                                                                | Documented, non-fatal — the model gracefully reports it couldn't get the weather                                                                                                                                                |
| `GET /capstone/status` shows `vectors` not yet reflecting a recent delete | Pinecone serverless's own eventual-consistency lag on `describeIndexStats()`                                                            | Wait a few seconds and re-check — not an application bug                                                                                                                                                                        |
