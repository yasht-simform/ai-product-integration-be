// Fixed, well-known demo identities the capstone seed/reset endpoints operate on — never
// user-supplied, since this module exists purely to make the platform demoable, not to accept
// arbitrary demo-data requests. Reusing the same constants for both seed() and reset() keeps the
// two operations trivially symmetric: reset() deletes exactly what seed() created.

export const DEMO_CONVERSATION_TITLE_PREFIX = '[Capstone Demo]';

export interface DemoConversationSeed {
  title: string;
  systemPrompt: string;
  toolsEnabled: boolean;
  messages: string[];
}

// 3 conversations exercising distinct Phase 2 capabilities (plain chat, function calling,
// product-question chat) with multi-turn history, per spec §3.3 step 4.
export const DEMO_CONVERSATIONS: DemoConversationSeed[] = [
  {
    title: `${DEMO_CONVERSATION_TITLE_PREFIX} Pricing Questions`,
    systemPrompt: 'You are a helpful CloudPulse support assistant.',
    toolsEnabled: false,
    messages: [
      "What's the difference between the Pro and Enterprise plans?",
      'Which one includes single sign-on (SSO)?',
    ],
  },
  {
    title: `${DEMO_CONVERSATION_TITLE_PREFIX} Quick Calculations`,
    systemPrompt: 'You are a helpful assistant with access to a calculator tool.',
    toolsEnabled: true,
    messages: ["What's 15% of 2499?", 'And what would 22% of that same number be?'],
  },
  {
    title: `${DEMO_CONVERSATION_TITLE_PREFIX} Onboarding Help`,
    systemPrompt: 'You are a helpful CloudPulse support assistant.',
    toolsEnabled: false,
    messages: [
      'How do I invite my team to a CloudPulse workspace?',
      'What roles can I assign to the people I invite?',
    ],
  },
];

export interface DemoBudgetSeed {
  userId: string;
  dailyLimitUsd?: number;
  monthlyLimitUsd?: number;
  alertThreshold: number;
}

// 3 users with different limit shapes (per spec §3.3 step 5) so the Cost Management demo page has
// something visually varied to show: a generous power user, a tightly-capped frugal user, and a
// monthly-only budget with no daily ceiling.
export const DEMO_BUDGETS: DemoBudgetSeed[] = [
  {
    userId: 'capstone-demo-alice',
    dailyLimitUsd: 5.0,
    monthlyLimitUsd: 100.0,
    alertThreshold: 0.8,
  },
  {
    userId: 'capstone-demo-bob',
    dailyLimitUsd: 0.5,
    monthlyLimitUsd: 10.0,
    alertThreshold: 0.8,
  },
  {
    userId: 'capstone-demo-carol',
    monthlyLimitUsd: 25.0,
    alertThreshold: 0.8,
  },
];

export const DEMO_USER_IDS = DEMO_BUDGETS.map((b) => b.userId);

// Default sample size for POST /capstone/run-evaluation and the evaluation step inside
// POST /capstone/seed — deliberately larger than MockDataService.evaluate()'s own 50-question
// default (still well under its 200 hard cap) since the capstone dataset has 250 Q&A pairs across
// 50 documents and a demo/report benefits from a broader sample than the general-purpose default.
export const CAPSTONE_EVAL_SAMPLE_SIZE = 100;

// The full capstone dataset shape (spec §3.1/§3.2) — used by CapstoneService.getStatus() to
// compute `ready` and by the integration tests to assert the seed produced exactly this shape.
export const CAPSTONE_DEMO_DOCUMENT_COUNT = 50;
export const CAPSTONE_DEMO_QA_PAIR_COUNT = 250;
