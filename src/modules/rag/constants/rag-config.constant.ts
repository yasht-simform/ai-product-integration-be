const NO_INFO_SENTINEL =
  "I don't have enough information to answer that based on the available documentation.";

export const RAG_CONFIG = {
  topK: 5,
  // text-embedding-3-small with ~500-token multi-topic chunks typically scores 0.4-0.6 for
  // relevant matches (measured live against both faker-generated and hand-written realistic
  // content — see CLAUDE.md's AI-055 follow-up sections); 0.3 is a safe floor that filters
  // noise without losing real results.
  similarityThreshold: 0.3,
  maxContextTokens: 4000,
  // Shared verbatim with generateQAPairs()'s edge-case expectedAnswer (AI-049) and AI-050's
  // evaluation heuristic, so both the model's actual refusal phrasing and the mock "correct"
  // answer for an unanswerable question stay in lockstep with a single source of truth.
  noInfoSentinel: NO_INFO_SENTINEL,
  systemPrompt:
    "You are a knowledgeable assistant. Answer the user's question using ONLY the provided " +
    `context documents. If the context doesn't contain the answer, say "${NO_INFO_SENTINEL}" ` +
    'Always cite which document(s) you used in your answer using [Source: filename] format.',
} as const;
