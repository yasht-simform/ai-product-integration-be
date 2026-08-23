# Phase 3: Vector Search & RAG — Testing Scenarios

> **Purpose:** Walk through every Phase 3 feature yourself, observe how it works, understand why.
> **Prerequisite:** Both servers running — BE on :3000, FE on :5173. Pinecone account configured.
> **Time:** 1.5–2 hours for all scenarios

---

## How to Use This Guide

Each scenario: **Do** → **Observe** → **Learn**
Go in order — later scenarios build on earlier ones.

---

## Part 1: Document Upload & Ingestion

### Scenario 3.1: Upload Your First Document (from Text)

**Do:**

1. Open the FE at http://localhost:5173
2. Click **"Knowledge Base"** in the left sidebar
3. You're on the **Documents** tab
4. Click **"Add from Text"** button
5. Fill in:
   - Title: `Company Return Policy`
   - Content: Paste this text:

     ```
     Return Policy for CloudPulse

     All CloudPulse subscriptions come with a 30-day money-back guarantee from the date of purchase. To request a return, contact support@cloudpulse.io with your order number.

     Refunds are processed within 5-7 business days. The refund will be credited to the original payment method.

     Enterprise plan customers have a 60-day return window and must contact their dedicated account manager.

     Annual subscriptions that are cancelled mid-term will receive a prorated refund for unused months.

     No refunds are available for add-on services (custom integrations, premium support hours) once they have been delivered.
     ```

   - Category: `docs` or `faq`
   - Tags: `policy, returns`

6. Click Create/Submit

**Observe:**

- A new document appears in the table
- **Embedding status** starts as `pending` or `processing` (blue spinner)
- Wait 10-30 seconds — status changes to `completed` (green badge)
- Chunks count and token count populate

**Learn:**

- When you upload a document, the **ingestion pipeline** runs automatically:
  1. Text is split into **chunks** (~500 tokens each with 50-token overlap)
  2. Each chunk is converted to a **vector embedding** (1536 numbers) via the OpenAI API
  3. The embedding is checked against the **cache** first (SHA-256 hash) — if it's been seen before, no API call needed
  4. The vector is stored in **Pinecone** for fast similarity search
  5. Chunk text + metadata is stored in **PostgreSQL**
- This is the "I" (Ingestion) step before R-A-G can work

---

### Scenario 3.2: Upload a Second Document (Different Topic)

**Do:**

1. Click "Add from Text" again
2. Title: `API Rate Limits`
3. Content:

   ```
   CloudPulse API Rate Limits

   Free plan: 100 requests per minute, 1000 requests per day.
   Pro plan: 500 requests per minute, 10000 requests per day.
   Enterprise plan: 2000 requests per minute, unlimited daily requests.

   When you exceed your rate limit, the API returns HTTP 429 Too Many Requests.
   Include a Retry-After header in your retry logic.

   Rate limits reset at midnight UTC every day for daily limits.
   Per-minute limits use a sliding window.

   You can monitor your current usage via the /api/usage endpoint or the CloudPulse dashboard under Settings > API Usage.
   ```

4. Category: `guide`
5. Wait for embedding to complete

**Observe:**

- Now you have 2 documents in the table
- Each has different chunk counts based on content length

**Learn:**

- Semantic search works across ALL documents — when you ask a question, Pinecone searches every stored vector regardless of which document it came from
- This is why RAG is powerful — you build a knowledge base from many documents and the AI searches all of them

---

### Scenario 3.3: Explore Chunks

**Do:**

1. Click on the return policy document row to expand it
2. Look at the chunks preview

**Observe:**

- The document was split into chunks
- Each chunk has: content text, token count, chunk index
- Adjacent chunks may overlap slightly at the boundaries

**Learn:**

- **Chunking** is critical for RAG — you can't embed an entire long document as one vector (context limits + poor search precision)
- **Overlap** (50 tokens between chunks) prevents losing context at boundaries — if a sentence spans two chunks, both contain it
- The chunking uses LangChain's `RecursiveCharacterTextSplitter` which splits at paragraph breaks, then sentences, then words — keeping text coherent

---

### Scenario 3.4: Check the Stats

**Do:**

1. Look at the stat cards at the top of the Knowledge Base page

**Observe:**

- **Total Documents**: 2
- **Total Chunks**: however many chunks were created
- **Vectors in Pinecone**: same as total chunks (each chunk = one vector)
- **Cache Hit Rate**: 0% (first time embedding, nothing cached yet)

**Learn:**

- Every chunk in PostgreSQL has a corresponding vector in Pinecone
- The cache hit rate will increase if you re-index the same documents (same text → same hash → cache hit)
- Stats come from `GET /rag/stats`

---

## Part 2: Semantic Search & RAG Q&A

### Scenario 3.5: Your First Semantic Search (via RAG Q&A)

**Do:**

1. Click the **Q&A** tab in Knowledge Base
2. In the question input, type: `What is the return window?`
3. Leave defaults (model, temperature, topK)
4. Click **Ask**

**Observe:**

- The AI generates an answer like: "The return window is 30 days from the date of purchase. Enterprise plan customers have a 60-day return window. [Source: Company Return Policy]"
- Below the answer, **Sources** section shows:
  - The relevant chunk from the return policy document
  - A **similarity score** as a percentage (e.g. "54% match")
  - The chunk text that was used as context
- **Metrics** show: tokens used, cost, total latency, search latency, generation latency

**Learn:**

- This is the full **RAG flow**:
  1. **R** (Retrieve): Your question is converted to an embedding, Pinecone finds the most similar chunks
  2. **A** (Augment): The retrieved chunks are injected into the prompt as context
  3. **G** (Generate): The AI generates an answer using ONLY the provided context
- The AI cites its sources — it tells you WHICH document it used
- Search latency (Pinecone) is typically fast (~100-200ms). Generation latency (LLM) is the majority of total time
- The system prompt forces the AI to say "I don't have enough information" if the context doesn't contain the answer

---

### Scenario 3.6: Cross-Document Search

**Do:**

1. Ask: `What happens when I exceed the rate limit?`

**Observe:**

- The answer comes from the API Rate Limits document, NOT the return policy
- Sources show chunks from the rate limits document with similarity scores

**Learn:**

- RAG searches across ALL documents — it found the relevant information even though you uploaded two different documents
- The AI doesn't need to know which document has the answer — Pinecone's vector similarity finds it automatically
- This is **semantic search** — it found "rate limit" content even if you phrased it differently than the document

---

### Scenario 3.7: Question the Docs Can't Answer

**Do:**

1. Ask: `What is the weather in London today?`

**Observe:**

- The AI should respond with something like: "I don't have enough information to answer that based on the available documentation"
- Sources may still show chunks but with LOW similarity scores

**Learn:**

- The RAG system prompt instructs the model: "Answer using ONLY the provided context. If the context doesn't contain the answer, say so."
- This prevents **hallucination** — the AI won't make up an answer
- Low similarity scores (below the 0.3 threshold) mean the retrieved chunks aren't actually relevant
- This is one of the biggest advantages of RAG over plain AI — it's grounded in YOUR data

---

### Scenario 3.8: Adjusting Search Parameters

**Do:**

1. Ask: `Tell me about the enterprise plan`
2. Note the results and sources
3. Now change **topK to 10** (retrieve more chunks)
4. Ask the same question again

**Observe:**

- With more chunks retrieved, the answer may be more comprehensive
- More sources appear in the Sources section
- Some sources have high scores, some low — the AI uses the relevant ones

**Now do:** 5. Change **temperature to 0** and ask again 6. Change **temperature to 1.0** and ask again

**Observe:**

- Temperature 0: factual, concise, sticks closely to the document text
- Temperature 1.0: more elaborated, may rephrase, but still grounded in the context

**Learn:**

- **topK** controls how many chunks are retrieved from Pinecone — more chunks = more context for the AI but also more tokens (more cost)
- **Temperature** in RAG should be LOW (0-0.3) for factual answers. High temperature increases the risk of the AI "creatively interpreting" the documents
- These are the main knobs for tuning RAG quality

---

### Scenario 3.9: Category Filtering

**Do:**

1. Set category filter to `docs` (or whatever category you used for the return policy)
2. Ask: `What are the rate limits?`

**Observe:**

- If the rate limits document is in a different category, the answer should be "I don't have enough information"
- The search only looked at documents in the selected category

**Learn:**

- Category filtering narrows the search scope — useful when you have many documents and want to search within a specific section of your knowledge base
- In Pinecone, this is a **metadata filter** applied before the vector similarity search

---

## Part 3: Mock Data & Evaluation

### Scenario 3.10: Seed Realistic Documents

**Do:**

1. Navigate to `/knowledge-base/evaluation` (or the Evaluation tab/sub-page)
2. Click **"Seed Realistic Dataset"**
3. Wait — this uploads 10 realistic CloudPulse documents and 50 Q&A pairs

**Observe:**

- Progress indicator while seeding
- After completion, go back to the Documents tab — you should see 10+ new documents
- Each document has a realistic title (e.g. "Getting Started Guide", "API Reference", "Pricing Plans")
- All should have `completed` embedding status

**Learn:**

- The realistic seed data contains coherent English text about a fictional product (CloudPulse)
- This produces meaningful embeddings (unlike faker's lorem ipsum)
- 50 Q&A pairs are categorized by complexity: simple (30), multi-step (10), edge-case (10)

---

### Scenario 3.11: Browse Q&A Pairs

**Do:**

1. On the evaluation page, look at the Q&A Pairs table
2. Filter by complexity: Simple, then Multi-step, then Edge-case

**Observe:**

- **Simple**: direct questions answerable from one chunk — "What is the default port?"
- **Multi-step**: questions needing multiple chunks — "Compare free and enterprise rate limits"
- **Edge-case**: questions the docs don't fully answer — "Can I return a custom integration after 45 days?"

**Learn:**

- Testing RAG at different complexity levels reveals how well the pipeline handles different question types
- Simple questions test basic retrieval accuracy
- Multi-step questions test whether the AI can synthesize information from multiple chunks
- Edge cases test whether the AI appropriately says "I don't know" vs hallucinating

---

### Scenario 3.12: Run Evaluation

**Do:**

1. Click **"Run Evaluation"**
2. Wait — this sends all 50 Q&A pairs through the RAG pipeline and scores them
3. This takes several minutes (50 RAG queries × ~5-30 seconds each)

**Observe:**

- Results appear as a dashboard:
  - Overall accuracy (should be ~74% based on our tests)
  - Breakdown by complexity: simple (~90%), multi-step (~100%), edge-case (~80%)
  - Bar chart showing the breakdown
  - Stats: total questions, correct, partially correct, incorrect

**Learn:**

- **Evaluation** is how you measure if your RAG pipeline actually works
- The goal doc says "Vary query complexity: simple facts, multi-step reasoning, edge cases"
- Simple questions should have highest accuracy — they're the baseline
- Multi-step being 100% means the AI successfully combines information from multiple retrieved chunks
- Edge-case 80% means the AI mostly says "I don't know" correctly, but sometimes still tries to answer
- In production, you'd run evaluation after every change to chunking, embeddings, or prompts to catch regressions

---

## Part 4: Advanced RAG Features

### Scenario 3.13: RAG in a Conversation

**Do:**

1. Go to the Q&A tab in Knowledge Base
2. Ask a question about the documents
3. Click **"Ask in Conversation"** (if available)
4. This should open/create a chat conversation with RAG context

**Or manually:**

1. Go to **Chat** (`/chat`)
2. Create a new conversation
3. Note: the conversation can use RAG context if connected to the knowledge base

**Observe:**

- The RAG answer appears in the conversation context
- You can ask follow-up questions that reference the previous RAG answer

**Learn:**

- **queryWithConversation** combines Phase 2 (chat history) with Phase 3 (RAG context)
- The AI has access to: conversation history + retrieved document chunks
- This enables: "What is the return policy?" → [RAG answer] → "What about enterprise specifically?" (follow-up uses chat history + potentially new RAG retrieval)
- The sliding window from Phase 2 manages the total context size including RAG chunks

---

### Scenario 3.14: Embedding Cache in Action

**Do:**

1. Check the Cache Hit Rate in the stats (should show some percentage now after seeding)
2. Pick one of the seeded documents
3. Click **Reindex** on that document
4. Check the Cache Hit Rate again

**Observe:**

- After reindexing, the cache hit rate should increase
- Reindexing the same content uses cached embeddings — fewer API calls, faster, cheaper

**Learn:**

- The **embedding cache** stores vectors keyed by SHA-256 hash of the text
- Same text → same hash → cache hit → no embedding API call needed
- This is the "Cache Embeddings" practice from the goal doc
- Saves money when: re-indexing documents, multiple documents share content, or documents are updated without text changes

---

### Scenario 3.15: Document Deletion Cascade

**Do:**

1. Note the current stats (documents, chunks, vectors)
2. Delete one of the seeded documents
3. Check stats again

**Observe:**

- Document count: -1
- Chunks count: reduced by that document's chunk count
- Vectors in Pinecone: also reduced (vectors deleted from Pinecone)

**Learn:**

- Deleting a document triggers a **cascade**:
  1. All `document_chunks` rows deleted from PostgreSQL
  2. All corresponding vectors deleted from Pinecone (by metadata filter)
  3. The `documents` row deleted
- No orphaned vectors in Pinecone, no orphaned chunks in PostgreSQL
- This is FR-RAG-009 from the spec

---

## Part 5: Understanding the Pipeline

### Scenario 3.16: Trace a RAG Query End-to-End

**Do:**

1. Ask a question in the Q&A tab
2. After getting the answer, go to **Audit Logs** (`/audit-logs`)
3. Look at the most recent entries

**Observe:**

- You should see **2 audit log entries** for this one question:
  1. `endpoint: embeddings` — the question was embedded (converted to a vector)
  2. `endpoint: chat.completions` — the augmented prompt (context + question) was sent to the LLM
- The embeddings call has lower tokens and cost than the chat completion

**Learn:**

- A single RAG query = **1 embedding call + 1 completion call** (minimum)
- The embedding call converts your question to a vector for Pinecone search
- The completion call sends the retrieved context + question to the LLM for answer generation
- Both are audited separately — full cost transparency
- If embeddings are cached (same question asked before), the embedding call is skipped

---

### Scenario 3.17: Check Audit Logs Dashboard

**Do:**

1. Go to **Dashboard** (`/`)
2. Look at the cost breakdown chart and recent calls

**Observe:**

- You'll see embedding calls alongside chat completion calls
- The Knowledge Base stat card shows document/vector counts
- Total costs include both embedding and completion costs

**Learn:**

- Phase 3 costs are tracked in the SAME audit system as Phase 1 and 2
- No separate logging — `AiAuditService` from Phase 1 handles everything
- This is the benefit of Phase 1's centralized architecture: new features (RAG, embeddings) automatically get retry, audit, and cost tracking

---

## Summary Checklist

After completing all scenarios, you should be able to explain:

### RAG Concepts

- [ ] What RAG is and its three steps (Retrieve, Augment, Generate)
- [ ] What vector embeddings are and why they enable semantic search
- [ ] How chunking works and why overlap matters
- [ ] Why the similarity threshold was set to 0.3 (not 0.7)
- [ ] What the embedding cache does and why it saves money

### Architecture

- [ ] How documents flow through the ingestion pipeline (parse → chunk → embed → Pinecone)
- [ ] How a RAG query works (embed question → search Pinecone → build prompt → generate)
- [ ] Why PostgreSQL stores text and Pinecone stores vectors (different strengths)
- [ ] How Phase 1 services (audit, retry, tokens) are reused by Phase 3
- [ ] What LangChain is used for (document loading, text splitting) and what it's NOT used for (chains, agents)

### Tools

- [ ] What Pinecone is and how cosine similarity works
- [ ] What tiktoken/text-embedding-3-small produces (1536-dimension vectors)
- [ ] What @faker-js/faker does and its limitation (weak embeddings from gibberish text)

### Evaluation

- [ ] Why you test at three complexity levels (simple, multi-step, edge-case)
- [ ] What a good evaluation score looks like (simple > 80%, edge-case says "I don't know")
- [ ] How to use evaluation to tune RAG parameters (topK, threshold, chunk size)

---

_Once you've checked everything above, move to Phase 4: Safety & Compliance._
