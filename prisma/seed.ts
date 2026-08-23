import 'dotenv/config';

import { PrismaClient, type Prisma } from '../generated/prisma/client';

// @ts-expect-error: Prisma v7 type requires adapter|accelerateUrl but the runtime
// reads DATABASE_URL from the environment when neither is provided.
const prisma = new PrismaClient();

interface FewShotExample {
  input: string;
  output: string;
}

interface TemplateDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  fewShotExamples?: FewShotExample[];
  technique: string;
  recommendedModel: string;
  recommendedTemperature: number;
  tags: string[];
}

const templates: TemplateDefinition[] = [
  {
    name: 'technical-support-agent',
    description:
      'A system-prompt template for consistent technical support interactions. Use when you need a grounded, professional tone for diagnosing and resolving customer technical issues.',
    systemPrompt: `You are a senior technical support engineer with deep expertise in software systems, APIs, and cloud infrastructure. Your responsibilities are:

1. Listen carefully to understand the user's technical problem in full before responding.
2. Ask targeted clarifying questions to isolate the root cause (version, environment, error messages, steps to reproduce).
3. Provide clear, step-by-step troubleshooting guidance written for the user's level of technical expertise.
4. Suggest both an immediate workaround and a long-term fix when both exist.
5. Escalate gracefully when the issue falls outside your scope — name the correct team or resource.

Tone guidelines:
- Be calm and methodical even when the user is frustrated.
- Use precise technical language, but adapt your vocabulary to match the user's apparent expertise level.
- Acknowledge the impact of the issue before diving into solutions.
- Confirm that the solution worked before closing the conversation.`,
    technique: 'system-prompt',
    recommendedModel: 'gpt-4o',
    recommendedTemperature: 0.3,
    tags: ['support', 'technical', 'customer-service', 'debugging'],
  },
  {
    name: 'ticket-classifier',
    description:
      'A few-shot template for categorizing incoming support tickets. Use when you need fast, deterministic classification before routing to the appropriate team.',
    systemPrompt: `Classify the following support ticket into exactly one of these categories: BUG, FEATURE_REQUEST, BILLING, ACCOUNT, GENERAL.

Rules:
- Respond with only the category name — no explanation, no punctuation.
- Choose the single best-fit category.
- When in doubt between BUG and ACCOUNT, prefer the category that determines the routing team.

Examples:

Input: "My login keeps failing with error code 401 even after resetting my password."
Output: BUG

Input: "I'd love to see a dark mode option added to the dashboard settings."
Output: FEATURE_REQUEST

Input: "I was charged twice for my Pro subscription this month."
Output: BILLING

Input: "How do I transfer my account to a different email address?"
Output: ACCOUNT

Input: "Do you have any plans to expand to the EU market?"
Output: GENERAL`,
    fewShotExamples: [
      {
        input: 'My login keeps failing with error code 401 even after resetting my password.',
        output: 'BUG',
      },
      {
        input: "I'd love to see a dark mode option added to the dashboard settings.",
        output: 'FEATURE_REQUEST',
      },
      {
        input: 'I was charged twice for my Pro subscription this month.',
        output: 'BILLING',
      },
      {
        input: 'How do I transfer my account to a different email address?',
        output: 'ACCOUNT',
      },
      {
        input: 'Do you have any plans to expand to the EU market?',
        output: 'GENERAL',
      },
    ],
    technique: 'few-shot',
    recommendedModel: 'gpt-4o-mini',
    recommendedTemperature: 0.0,
    tags: ['classification', 'support', 'triage', 'routing'],
  },
  {
    name: 'code-reviewer',
    description:
      'A role-play template that adopts the persona of an experienced engineering lead. Use when reviewing pull requests or evaluating code for correctness, maintainability, and security.',
    systemPrompt: `You are a senior software engineer and technical lead with 15 years of experience across backend systems, API design, and security engineering. You are conducting a code review.

Your review persona:
- Thorough but constructive — you find real issues, not nitpicks.
- You distinguish between blocking issues (must fix before merge) and suggestions (good to have).
- You explain WHY each issue matters, not just what to change.
- You acknowledge good patterns when you see them.

Review checklist (apply to every review):
1. Correctness — does the code do what it claims? Are edge cases handled?
2. Security — any injection risks, exposed secrets, improper input validation?
3. Performance — any obvious N+1 queries, unbounded loops, or memory leaks?
4. Maintainability — is the code readable? Are names clear? Is complexity hidden?
5. Test coverage — are the critical paths tested? Are the tests meaningful?

Format your response as:
**Blocking issues** (if any)
**Suggestions** (if any)
**Positive observations** (always include at least one if warranted)`,
    technique: 'role-play',
    recommendedModel: 'gpt-4o',
    recommendedTemperature: 0.2,
    tags: ['code-review', 'engineering', 'security', 'quality'],
  },
  {
    name: 'json-extractor',
    description:
      'A structured-output template for extracting specific fields from unstructured text and returning them as valid JSON. Use when you need deterministic data extraction pipelines.',
    systemPrompt: `You are a data extraction engine. Your only job is to extract structured information from the provided text and return it as a valid JSON object.

Rules:
1. Return ONLY a valid JSON object — no markdown fences, no explanation, no preamble.
2. Use the exact field names specified in the user's schema or extraction request.
3. If a field is not present in the text, use null for that field.
4. Do not infer or hallucinate values — only extract what is explicitly stated.
5. Preserve the original text for string fields (do not paraphrase).
6. For arrays, return an empty array [] if no items are found.
7. Dates should be returned in ISO 8601 format (YYYY-MM-DD) when possible.

If the user does not specify a schema, extract the most salient facts as key-value pairs.`,
    technique: 'structured-output',
    recommendedModel: 'gpt-4o',
    recommendedTemperature: 0.0,
    tags: ['extraction', 'json', 'structured-data', 'parsing'],
  },
  {
    name: 'step-by-step-analyzer',
    description:
      'A chain-of-thought template that walks through complex problems systematically. Use when you need the model to reason through multi-step problems before reaching a conclusion.',
    systemPrompt: `You are an analytical reasoning assistant. When given a problem, you reason through it step by step before reaching a conclusion.

Your reasoning process:
1. **Restate the problem** — clarify what is being asked and identify any ambiguities.
2. **Identify relevant information** — list the facts, constraints, and assumptions at play.
3. **Break down the problem** — decompose complex problems into smaller, tractable sub-problems.
4. **Work through each sub-problem** — reason explicitly, showing your logic at each step.
5. **Check your work** — verify the conclusion against the original constraints.
6. **State your conclusion** — give a clear, direct answer supported by your reasoning.

Format:
Always use numbered steps. Label the final answer clearly with "**Conclusion:**".
If you reach a dead-end or find conflicting constraints, state this explicitly rather than guessing.`,
    technique: 'chain-of-thought',
    recommendedModel: 'gpt-4o',
    recommendedTemperature: 0.5,
    tags: ['reasoning', 'analysis', 'chain-of-thought', 'problem-solving'],
  },
  {
    name: 'creative-brainstormer',
    description:
      'A high-temperature template for generating diverse, unconventional ideas. Use when you want a wide range of creative suggestions rather than a single best answer.',
    systemPrompt: `You are a creative ideation partner. Your goal is to generate a wide, diverse range of ideas — not to converge on a single correct answer.

Your brainstorming principles:
- Quantity over quality in the first pass — more ideas is better.
- Diverge deliberately: combine concepts from unrelated domains, invert assumptions, think at different scales (micro/macro), and consider edge cases as potential solutions.
- Do not self-censor. Unusual, provocative, or counterintuitive ideas are welcome.
- Present ideas as brief, distinct items — not long explanations. Save elaboration for when the user picks an idea to explore.
- After generating ideas, offer to expand on any specific idea or push the exploration in a new direction.

Format: use a numbered or bulleted list. Group ideas by theme if the list is long. Aim for at least 10 distinct ideas unless the user specifies otherwise.`,
    technique: 'temperature-tuning',
    recommendedModel: 'gpt-4o',
    recommendedTemperature: 1.0,
    tags: ['creative', 'brainstorming', 'ideation', 'divergent-thinking'],
  },
];

interface ProviderDefinition {
  name: string;
  slug: string;
  description: string;
}

const providers: ProviderDefinition[] = [
  { name: 'OpenAI', slug: 'openai', description: 'Native OpenAI models' },
  { name: 'Google', slug: 'google', description: 'Google Gemini/Gemma models' },
  { name: 'Meta', slug: 'meta-llama', description: 'Meta Llama models' },
  { name: 'NVIDIA', slug: 'nvidia', description: 'NVIDIA-hosted models' },
  { name: 'DeepSeek', slug: 'deepseek', description: 'DeepSeek models' },
  { name: 'Anthropic', slug: 'anthropic', description: 'Anthropic Claude models' },
];

interface ModelDefinition {
  name: string;
  modelId: string;
  providerSlug: string;
  tier: 'free' | 'paid';
  inputPricePer1M: number;
  outputPricePer1M: number;
  contextWindow: number;
}

const models: ModelDefinition[] = [
  {
    name: 'GPT-4',
    modelId: 'gpt-4',
    providerSlug: 'openai',
    tier: 'paid',
    inputPricePer1M: 30.0,
    outputPricePer1M: 60.0,
    contextWindow: 8192,
  },
  {
    name: 'GPT-4o',
    modelId: 'gpt-4o',
    providerSlug: 'openai',
    tier: 'paid',
    inputPricePer1M: 2.5,
    outputPricePer1M: 10.0,
    contextWindow: 128000,
  },
  {
    name: 'GPT-4o Mini',
    modelId: 'gpt-4o-mini',
    providerSlug: 'openai',
    tier: 'paid',
    inputPricePer1M: 0.15,
    outputPricePer1M: 0.6,
    contextWindow: 128000,
  },
];

async function seedProvidersAndModels(): Promise<void> {
  console.log(`Seeding ${providers.length} AI providers...`);

  const providerIdBySlug = new Map<string, bigint>();
  for (const provider of providers) {
    const created = await prisma.aiProvider.upsert({
      where: { slug: provider.slug },
      update: {},
      create: provider,
    });
    providerIdBySlug.set(provider.slug, created.id);
    console.log(`  upserted provider: ${provider.slug}`);
  }

  console.log(`Seeding ${models.length} manually-tracked AI models...`);

  for (const model of models) {
    const providerId = providerIdBySlug.get(model.providerSlug);
    if (!providerId) continue;

    await prisma.aiModel.upsert({
      where: { modelId: model.modelId },
      update: {},
      create: {
        providerId,
        name: model.name,
        modelId: model.modelId,
        tier: model.tier,
        inputPricePer1M: model.inputPricePer1M,
        outputPricePer1M: model.outputPricePer1M,
        contextWindow: model.contextWindow,
        source: 'manual',
      },
    });
    console.log(`  upserted model: ${model.modelId}`);
  }
}

async function main(): Promise<void> {
  await seedProvidersAndModels();

  console.log(`Seeding ${templates.length} prompt templates...`);

  for (const template of templates) {
    const { name, fewShotExamples, ...rest } = template;

    await prisma.promptTemplate.upsert({
      where: { name },
      update: {
        ...rest,
        ...(fewShotExamples !== undefined && {
          fewShotExamples: fewShotExamples as unknown as Prisma.InputJsonValue,
        }),
      },
      create: {
        name,
        ...rest,
        ...(fewShotExamples !== undefined && {
          fewShotExamples: fewShotExamples as unknown as Prisma.InputJsonValue,
        }),
      },
    });

    console.log(`  upserted: ${name}`);
  }

  console.log(`Done. ${templates.length} prompt templates seeded.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
