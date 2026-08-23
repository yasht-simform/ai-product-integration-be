import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type OpenAI from 'openai';

import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { ChatService } from '../../ai-chat/services/chat.service';
import { ModelRegistryService } from '../../openai/services/model-registry.service';
import { OpenaiService } from '../../openai/services/openai.service';
import { TokenService } from '../../openai/services/token.service';
import { RAG_CONFIG } from '../constants/rag-config.constant';
import type { RagOptions, RagResult, RagSource, SearchResult } from '../types/rag.types';
import { SearchService } from './search.service';

const DEFAULT_RAG_TEMPERATURE = 0.3;
const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_CONTEXT_WINDOW_PERCENTAGE = 0.8;

@Injectable()
export class RagService {
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
    private readonly searchService: SearchService,
    private readonly openaiService: OpenaiService,
    private readonly tokenService: TokenService,
    private readonly modelRegistryService: ModelRegistryService,
    private readonly chatService: ChatService,
  ) {}

  async query(question: string, options: RagOptions = {}): Promise<RagResult> {
    const overallStart = Date.now();

    const searchStart = Date.now();
    const results = await this.searchService.search(question, {
      topK: options.topK,
      categoryFilter: options.categoryFilter,
    });
    const searchLatencyMs = Date.now() - searchStart;

    const messages = this.buildAugmentedMessages(question, results);

    const generationStart = Date.now();
    const completion = await this.openaiService.chatCompletionWithMessages({
      messages,
      model: options.model,
      temperature: options.temperature ?? DEFAULT_RAG_TEMPERATURE,
    });
    const generationLatencyMs = Date.now() - generationStart;

    const sources: RagSource[] = results.map((result) => ({
      documentTitle: result.documentTitle,
      documentPublicId: result.documentPublicId,
      chunkContent: result.content,
      chunkIndex: result.chunkIndex,
      similarityScore: result.score,
    }));

    return {
      answer: completion.content,
      model: completion.model,
      sources,
      usage: completion.usage,
      estimatedCost: completion.estimatedCost,
      latencyMs: Date.now() - overallStart,
      chunksRetrieved: results.length,
      searchLatencyMs,
      generationLatencyMs,
    };
  }

  async queryWithConversation(
    conversationPublicId: string,
    question: string,
    options: RagOptions = {},
  ): Promise<RagResult> {
    const overallStart = Date.now();

    if (!question.trim()) {
      throw new BadRequestException('question must not be empty or whitespace-only');
    }

    const { id: conversationId, model: conversationModel } =
      await this.chatService.getConversationHandle(conversationPublicId);
    const model = options.model ?? conversationModel;

    // Persisted before retrieval/generation, mirroring ChatService.sendMessage()'s own resilience
    // pattern — a mid-request crash leaves a recoverable, normal-looking user turn in storage.
    await this.chatService.addUserMessage(conversationId, question);

    const searchStart = Date.now();
    const results = await this.searchService.search(question, {
      topK: options.topK,
      categoryFilter: options.categoryFilter,
    });
    const searchLatencyMs = Date.now() - searchStart;

    const { messages, chunksUsed } = await this.spliceRetrievedChunks(
      conversationId,
      question,
      results,
      model,
    );

    const generationStart = Date.now();
    const completion = await this.openaiService.chatCompletionWithMessages({
      messages,
      model,
      temperature: options.temperature ?? DEFAULT_RAG_TEMPERATURE,
    });
    const generationLatencyMs = Date.now() - generationStart;

    await this.chatService.addAssistantMessage(conversationId, {
      content: completion.content || null,
      tokenCount: completion.usage.totalTokens,
      cost: completion.estimatedCost,
      latencyMs: completion.latencyMs,
      model: completion.model,
    });

    const sources: RagSource[] = chunksUsed.map((result) => ({
      documentTitle: result.documentTitle,
      documentPublicId: result.documentPublicId,
      chunkContent: result.content,
      chunkIndex: result.chunkIndex,
      similarityScore: result.score,
    }));

    return {
      answer: completion.content,
      model: completion.model,
      sources,
      usage: completion.usage,
      estimatedCost: completion.estimatedCost,
      latencyMs: Date.now() - overallStart,
      chunksRetrieved: chunksUsed.length,
      searchLatencyMs,
      generationLatencyMs,
    };
  }

  private buildAugmentedMessages(
    question: string,
    results: SearchResult[],
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    const contextBlock = this.buildContextBlock(results);

    return [
      { role: 'system', content: RAG_CONFIG.systemPrompt },
      { role: 'user', content: `${contextBlock}\n\nQuestion: ${question}` },
    ];
  }

  // Splices retrieved chunks into the tail of ChatService.buildContext()'s own sliding-window
  // history — the just-persisted user message is always the last entry in that array — rather
  // than reimplementing context trimming. If the spliced-in chunk content would push the combined
  // array over the model's context-window budget, chunks are dropped from the lowest-ranked end
  // first (never conversation history, which buildContext() has already sized correctly on its
  // own terms).
  private async spliceRetrievedChunks(
    conversationId: bigint,
    question: string,
    results: SearchResult[],
    model: string,
  ): Promise<{ messages: OpenAI.Chat.ChatCompletionMessageParam[]; chunksUsed: SearchResult[] }> {
    const baseMessages = await this.chatService.buildContext(conversationId);
    const budget = await this.resolveContextBudget(model);
    const historyTokens = this.sumTokens(baseMessages.slice(0, -1), model);

    let chunksUsed = results;
    let messages = this.spliceLastMessage(baseMessages, question, chunksUsed);

    while (
      chunksUsed.length > 0 &&
      historyTokens + this.lastMessageTokens(messages, model) > budget
    ) {
      chunksUsed = chunksUsed.slice(0, -1);
      messages = this.spliceLastMessage(baseMessages, question, chunksUsed);
    }

    return { messages, chunksUsed };
  }

  private async resolveContextBudget(model: string): Promise<number> {
    const modelInfo = await this.modelRegistryService.findModelByModelId(model);
    const contextWindow =
      modelInfo?.contextWindow ??
      this.configService.get<number>('chat.defaultContextWindow') ??
      DEFAULT_CONTEXT_WINDOW;
    const contextWindowPercentage =
      this.configService.get<number>('chat.contextWindowPercentage') ??
      DEFAULT_CONTEXT_WINDOW_PERCENTAGE;

    return contextWindow * contextWindowPercentage;
  }

  private spliceLastMessage(
    baseMessages: OpenAI.Chat.ChatCompletionMessageParam[],
    question: string,
    chunksUsed: SearchResult[],
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    const contextBlock = this.buildContextBlock(chunksUsed);
    const spliced = [...baseMessages];
    spliced[spliced.length - 1] = {
      role: 'user',
      content: `${contextBlock}\n\nQuestion: ${question}`,
    };
    return spliced;
  }

  private sumTokens(messages: OpenAI.Chat.ChatCompletionMessageParam[], model: string): number {
    return messages.reduce(
      (sum, message) => sum + this.tokenService.countTokens(this.extractContent(message), model),
      0,
    );
  }

  private lastMessageTokens(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    model: string,
  ): number {
    const last = messages[messages.length - 1];
    return last ? this.tokenService.countTokens(this.extractContent(last), model) : 0;
  }

  private extractContent(message: OpenAI.Chat.ChatCompletionMessageParam): string {
    return typeof message.content === 'string' ? message.content : '';
  }

  private buildContextBlock(results: SearchResult[]): string {
    if (results.length === 0) {
      return 'Context: No relevant documents were found for this question.';
    }

    const numberedChunks = results
      .map(
        (result, index) => `[${index + 1}] (Source: "${result.documentTitle}")\n${result.content}`,
      )
      .join('\n\n');

    return `Context:\n${numberedChunks}`;
  }
}
