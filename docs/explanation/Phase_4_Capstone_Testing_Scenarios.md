# Phase 4: Safety & Compliance + Capstone — Testing Scenarios

> **Purpose:** Walk through every Phase 4 feature and the capstone demo yourself.
> **Prerequisite:** Both servers running — BE on :3000, FE on :5173. Demo data seeded.
> **Time:** 1.5–2 hours for all scenarios

---

## How to Use This Guide

Each scenario: **Do** → **Observe** → **Learn**
Go in order — later scenarios build on earlier ones.

---

## Part 1: Content Moderation

### Scenario 4.1: Moderate Clean Text

**Do:**

1. Go to **Moderation** (`/moderation`) in the sidebar
2. You're on the **Moderation Tester** tab
3. In the text area, type: `Hello, how are you today? The weather is nice.`
4. Click **Check**

**Observe:**

- Large green **"SAFE"** badge appears
- Category grid shows ALL moderation categories (hate, harassment, self-harm, sexual, violence, etc.)
- Every category shows a very low score (close to 0) with green bars
- Highest score is probably under 0.01

**Learn:**

- The OpenAI moderation API analyzes text across **11 categories** of harmful content
- Each category gets a **confidence score** from 0 to 1
- Clean text scores near 0 across all categories
- The moderation API is **FREE** — no per-call cost, which is why we can check everything
- This works via `OpenaiService.moderateText()` which uses `openai.moderations.create()`

---

### Scenario 4.2: Moderate Flagged Text

**Do:**

1. In the moderation tester, type something that would clearly violate content policies (e.g. explicit threats of violence — use obviously fictional/testing language)
2. Click **Check**

**Observe:**

- Large red **"FLAGGED"** badge appears
- One or more categories highlighted in red with high scores (0.7+)
- `flaggedCategories` array shows which categories were triggered
- `highestScore` shows the worst category

**Note:** If you're using `MODERATION_STATIC_MODE=true` (because OpenRouter doesn't proxy the moderation endpoint), you'll get static mock responses. The categories and scores will be predefined test data, not real API results. Switch to a direct OpenAI key or Azure to test with the real moderation API.

**Learn:**

- The moderation API returns **both** a boolean flag AND granular scores per category
- The `MODERATION_BLOCK_THRESHOLD` (default 0.7) determines what score triggers a flag
- This is what `ModerationGuard` checks before every AI call — flagged input never reaches the model
- The guard returns **422 Unprocessable Entity** (not 403) — semantically "your content can't be processed"

---

### Scenario 4.3: Moderation Guard in Action

**Do:**

1. Go to **Chat** (`/chat`)
2. Create a new conversation
3. Try sending a message with content that would be flagged
4. Check what happens

**Observe:**

- If moderation is enabled and detects a violation: you get a **422 error** — the message is NEVER saved to the conversation, NEVER sent to the AI model
- If moderation is disabled (`MODERATION_ENABLED=false`): the message goes through normally

**Now do:** 5. Go to **Moderation** → **Moderation Logs** tab 6. Look at the log entries

**Observe:**

- Every moderation check is logged — both "allowed" and "blocked"
- Each log shows: direction (input/output), action (allowed/blocked/replaced), content (truncated), categories, scores

**Learn:**

- The `ModerationGuard` runs **before** the chat handler — if content is flagged, no money is spent on an AI call
- This is why guard ordering matters: moderation first, then budget check
- Every check is logged **fire-and-forget** — a logging failure never blocks the user's request
- The guard extracts text from the request body using configurable field names (`content` for chat, `question` for RAG)

---

### Scenario 4.4: Output Moderation (If Enabled)

**Do:**

1. Check your `.env` — is `MODERATION_OUTPUT_ENABLED=true`?
2. If not, this scenario shows what WOULD happen (explain the concept)

**How output moderation works (conceptual):**

- After the AI generates a response, the `OutputModerationInterceptor` checks it
- If flagged: the response content is **replaced** with "I'm sorry, I can't provide that type of content"
- The original content is logged in `moderation_logs` for review
- The user gets a safe response, not an error (the AI cost is already spent — throwing would waste it)

**Learn:**

- **Input moderation = guard (block before spending)**: saves money, prevents bad content from reaching the model
- **Output moderation = interceptor (replace after spending)**: the tokens are already paid for, so replace the content instead of throwing an error
- Output moderation is **off by default** (`MODERATION_OUTPUT_ENABLED=false`) because it adds latency to every response
- It does NOT apply to SSE streaming (documented limitation — the stream has already been sent)

---

### Scenario 4.5: Moderation Stats

**Do:**

1. Go to **Moderation** page
2. Look at the stat cards at the top

**Observe:**

- Total Checks: how many moderation checks have been performed
- Flagged Count: how many were flagged
- Violation Rate: percentage of flagged checks
- Top Categories: which violation categories appear most

**Learn:**

- These stats come from aggregating the `moderation_logs` table
- In a real production app, a rising violation rate might indicate an attack or misuse pattern
- The stats endpoint helps compliance teams monitor AI safety without reading individual logs

---

## Part 2: Cost Budgets

### Scenario 4.6: Create a Budget

**Do:**

1. Go to **Cost Management** (`/cost`)
2. You're on the **Budgets** tab
3. Click **Create Budget**
4. Fill in:
   - User ID: `test-user-1`
   - Daily Limit: `$1.00`
   - Monthly Limit: `$20.00`
   - Alert Threshold: `0.8` (warn at 80%)
5. Create the budget

**Observe:**

- A new budget row appears in the table
- Shows: userId, daily limit, monthly limit, current spend ($0.00), progress bars (empty/green)

**Learn:**

- Budgets are **per user** — one budget per userId
- The budget doesn't create a new spending tracking system — it reads from the existing `ai_audit_logs` table
- `alertThreshold: 0.8` means "warn when spend reaches 80% of the limit"

---

### Scenario 4.7: Budget Enforcement

**Do:**

1. Create a budget with a very low daily limit: `$0.001`
2. Go to **Chat**, create a conversation
3. Make sure to include an `x-user-id` header (or use the userId field if your FE supports it)
4. Send a message — it should succeed (first call is under budget)
5. Send another message

**Observe:**

- First call: succeeds normally
- Second call (if the first used more than $0.001): **429 Too Many Requests** — "Daily budget exceeded ($X.XX of $0.001)"
- The 429 response includes your current spend and the limit

**Learn:**

- Budget enforcement uses a **guard** (`CostBudgetGuard`) that runs before every AI call
- It checks the user's accumulated spend from `ai_audit_logs`
- **429** (not 403) is the correct status — it means "resource exhausted" (like rate limiting), not "forbidden"
- The spend is cached in memory (60-second TTL) so the guard doesn't query the DB on every request
- This means there's up to 60 seconds of "overshoot" possible — a user might slightly exceed their limit before the cache refreshes

---

### Scenario 4.8: Budget Warning Headers

**Do:**

1. Create a budget: daily $1.00, alert at 0.5 (50%)
2. Make AI calls until you've spent ~$0.60 (over 50% of $1.00)
3. Make another call

**Observe:**

- The response includes a warning header: `X-Budget-Warning: Approaching daily limit (65%)`
- The call still succeeds — warnings don't block

**Learn:**

- Warnings are **proactive** — they alert before blocking
- This gives the user (or their application) a chance to slow down before hitting the hard limit
- The threshold is configurable per budget via `alertThreshold`

---

### Scenario 4.9: Budget Alerts Dashboard

**Do:**

1. Go to **Cost Management** → **Budgets** tab
2. Look for the "Alerts" section at the top (users approaching their limits)

**Observe:**

- Users who have crossed their `alertThreshold` appear here with warning styling
- Shows: userId, current daily/monthly spend, limits, percentages

**Learn:**

- `GET /cost/budgets/alerts` gives admins a proactive view of who's about to be blocked
- In a real app, this would trigger notifications (email, Slack) — out of scope for this project but the data is there

---

## Part 3: Cost Analytics

### Scenario 4.10: Spend by User

**Do:**

1. Go to **Cost Management** → **Analytics** tab
2. Look at the "Spend by User" section

**Observe:**

- Bar chart showing cost per user
- Table: user ID, total cost, call count, average cost per call
- Users sorted by total cost (highest first)

**Learn:**

- This answers: "Who is spending the most on AI?"
- Data comes from aggregating `ai_audit_logs` by `userId`
- Only `SUCCESS` calls count — failed calls cost nothing

---

### Scenario 4.11: Spend by Model

**Do:**

1. Look at the "Spend by Model" section

**Observe:**

- Horizontal bar chart: model name vs total cost
- Free models show $0.00
- Paid models (if any were used) show actual costs

**Learn:**

- This answers: "Which model is costing us the most?"
- Helps you decide: should you switch from GPT-4o to GPT-4o-mini for certain tasks?
- The 200x price difference between models makes this a critical business decision

---

### Scenario 4.12: Spend by Feature

**Do:**

1. Look at the "Spend by Feature" section

**Observe:**

- Pie/donut chart: chat vs embeddings vs moderations
- Chat (completions) is likely the biggest slice
- Moderations should show $0 (it's free)
- Embeddings may show some cost from document ingestion

**Learn:**

- This answers: "Which AI feature drives the most cost?"
- Feature attribution comes from the `endpoint` column in `ai_audit_logs`:
  - `chat.completions` → chat/RAG
  - `embeddings` → document embedding
  - `moderations` → content moderation ($0)
- Note: chat and RAG both use `chat.completions` — they can't be distinguished in this phase

---

### Scenario 4.13: Projected Monthly Spend

**Do:**

1. Look at the "Projected Monthly" card

**Observe:**

- Shows: month-to-date spend, daily average, days elapsed, days remaining, **projected monthly total**
- Formula: `(monthToDateSpend / daysElapsed) × daysInMonth`

**Learn:**

- This answers: "How much will we spend by month end?"
- It's a simple linear projection — doesn't account for weekends, holidays, or usage patterns
- But it's the most impactful single metric for budget planning
- In a real company, this number would be on a finance dashboard

---

### Scenario 4.14: Spend Timeline

**Do:**

1. Go to **Cost Management** → **Spend Timeline** tab
2. Select "Last 7 days" or "Last 30 days"

**Observe:**

- Line chart: daily spend over time
- Below: table with daily breakdown (date, cost, call count)
- Trend arrow: up or down compared to previous period

**Learn:**

- This answers: "Is our AI spending going up or down?"
- Visual trends are easier to spot than raw numbers
- Spikes might indicate: a new feature launch, a user testing heavily, or a bug making too many calls
- The data uses `$queryRaw` with PostgreSQL's `date_trunc` — the codebase's first raw SQL query

---

## Part 4: Data Retention

### Scenario 4.15: View Retention Config

**Do:**

1. Go to **Data Retention** (`/retention`)
2. Look at the current config

**Observe:**

- Audit Logs: 90 days
- Moderation Logs: 90 days
- Archived Conversations: 30 days
- Embedding Cache: 180 days
- Cleanup Schedule: `0 2 * * *` (daily at 2 AM)

**Learn:**

- Retention is **time-based** — data older than the configured period gets deleted
- Different data types have different retention periods based on their value:
  - Audit logs (90 days): needed for cost tracking and debugging
  - Archived conversations (30 days): already hidden from the user, safe to remove sooner
  - Embedding cache (180 days): longer because re-embedding costs money
- The cron runs automatically — no manual intervention needed

---

### Scenario 4.16: Trigger Manual Cleanup

**Do:**

1. On the retention page, check "Records Due for Cleanup" stats
2. Click **"Run Cleanup Now"**

**Observe:**

- Result shows: "Deleted: X audit logs, Y moderation logs, Z conversations, W cache entries (took Xms)"
- If you just started the app recently, most counts will be 0 (nothing is old enough yet)

**Learn:**

- Manual cleanup is for testing and emergency situations
- The automatic cron handles daily cleanup in production
- Cleanup happens in **batches** (not one giant DELETE) to avoid long database locks
- **Safety guarantee**: active (non-archived) conversations are NEVER deleted, regardless of age
- Documents and their chunks are NEVER auto-deleted — only manual deletion removes them

---

### Scenario 4.17: Verify Safety Invariant

**Do:**

1. Go to **Chat**, create a conversation, send a message (so it has an old timestamp if you fake it)
2. Verify the conversation is NOT archived
3. Trigger cleanup
4. Go back to Chat — the conversation should still be there

**Observe:**

- Active conversations are untouched by retention cleanup
- Only **archived** conversations older than the retention period are deleted

**Learn:**

- This is **FR-RET-002**: "Retention MUST never delete active conversations, documents, or chunks"
- The cleanup query explicitly filters: `WHERE isArchived = true AND updatedAt < cutoff`
- This is "safe by construction" — the DELETE query structurally cannot touch active data
- Even if someone misconfigures retention to 0 days, active conversations survive

---

## Part 5: Capstone — Everything Together

### Scenario 5.1: Seed the Demo Dataset

**Do:**

1. Go to **Dashboard** (`/`)
2. Look for the **Demo Controls** card (may be at the bottom, collapsible)
3. Click **"Seed Demo Data"**
4. Wait 2-5 minutes (this uploads 50 documents, embeds them all, creates Q&A pairs)

**Observe:**

- Loading spinner during seeding
- When done: "Demo Ready ✅" with stats: 50 documents, X chunks, Y vectors, 250 Q&A pairs

**Learn:**

- The seed endpoint does everything: create documents, trigger embedding pipeline, store vectors in Pinecone, create Q&A pairs, create sample conversations, create sample budgets
- This is the full Phase 3 ingestion pipeline running at scale

---

### Scenario 5.2: Run the Demo Evaluation

**Do:**

1. In Demo Controls, click **"Run Evaluation"**
2. Wait (this runs all 250 Q&A pairs through the RAG pipeline)

**Observe:**

- Results show: overall accuracy, breakdown by complexity
- Target: simple > 70%, multi-step > 50%, edge-case handles "I don't know" correctly

**Learn:**

- Evaluation proves the RAG pipeline works across 250 different questions
- The three complexity tiers test different capabilities:
  - Simple: can the system find one relevant chunk?
  - Multi-step: can it combine information from multiple chunks?
  - Edge case: does it know when to say "I don't know"?

---

### Scenario 5.3: Walk Through the Demo Script

**Do:**

1. Click the **"Guide"** button in the header (? icon)
2. Follow the 10-step demo walkthrough
3. Check off each step as you complete it

**Learn:**

- This is how you'd present the project to your team or manager
- Each step shows a different capability from a different phase
- The full demo takes 15-20 minutes and covers all 5 learning areas from the goal doc

---

### Scenario 5.4: Cross-Phase Integration Check

**Do:**

1. Go to Knowledge Base → Q&A tab
2. Ask a question about the CloudPulse documents
3. Check: answer has citations ✓
4. Go to Audit Logs → filter recent entries
5. You should see: 1 embedding call (question embedded) + 1 completion call (answer generated)
6. Go to Moderation → Logs tab
7. If moderation is enabled, you should see the input check logged
8. Go to Cost Management → Analytics
9. The calls you just made should appear in the spend breakdown

**Observe:**

- One user action (asking a question) flows through ALL four phases:
  - Phase 1: retry engine, audit logging, cost tracking
  - Phase 3: embedding, Pinecone search, RAG generation
  - Phase 4: moderation check, budget check (if configured), all logged

**Learn:**

- This is the whole point of the architecture: every AI feature built on Phase 1's foundation gets retry, audit, and cost tracking automatically
- New features (moderation, budgets) are additive guards — they don't change existing service logic
- The audit trail gives complete visibility into every AI interaction across the entire system

---

## Summary Checklist

After completing all scenarios, you should be able to explain:

### Content Moderation

- [ ] How the OpenAI moderation API works (categories, scores, free)
- [ ] What ModerationGuard does (input check, 422 on flag)
- [ ] What OutputModerationInterceptor does (replace, don't throw)
- [ ] Why moderation fails open (API error lets request through)
- [ ] Guard ordering: moderation first, then budget

### Cost Budgets

- [ ] How budget enforcement works (guard reads from audit logs)
- [ ] Why 429 not 403 (resource exhausted, not forbidden)
- [ ] The 60-second cache tradeoff
- [ ] What happens with no userId (passes through)
- [ ] Warning headers at threshold

### Cost Analytics

- [ ] The 6 analytics queries (by user, model, feature, timeline, trend, projected)
- [ ] Projected monthly spend formula
- [ ] Why only SUCCESS calls count

### Data Retention

- [ ] The 4 cleanup categories and their retention periods
- [ ] Why active conversations are structurally safe
- [ ] Batch deletion for performance
- [ ] Cron scheduling via SchedulerRegistry

### Full System

- [ ] How all 4 phases connect in a single user request
- [ ] Why every AI call goes through OpenaiService (never direct SDK)
- [ ] The complete audit trail from user action to logged cost
- [ ] What 100% of the goal doc's requirements map to in this system

---

_Congratulations — you've built and tested a complete AI Product Integration platform.
75 issues, 705+ tests, 4 phases, all 5 learning areas from the G3 goal doc. 🎉_
