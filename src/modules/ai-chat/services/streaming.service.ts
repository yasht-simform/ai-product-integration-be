import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { APIUserAbortError } from 'openai';

import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { OPENAI_CLIENT } from '../../openai/constants/injection-tokens';
import { OpenAIModel } from '../../openai/constants/openai-model.enum';
import { StreamEventType } from '../constants/stream-event-type.enum';
import type { StreamCompletionOptions, StreamEvent, ToolCallData } from '../types/ai-chat.types';

interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

@Injectable()
export class StreamingService {
  constructor(
    @Inject(OPENAI_CLIENT) private readonly openaiClient: OpenAI,
    private readonly logger: AppLoggerService,
    private readonly configService: ConfigService,
  ) {}

  async *streamCompletion(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    options: StreamCompletionOptions = {},
  ): AsyncGenerator<StreamEvent> {
    const {
      model = this.configService.get<string>('openai.defaultModel') ?? OpenAIModel.GPT_4O,
      temperature,
      tools,
      signal,
    } = options;

    const toolCallAccumulators = new Map<number, ToolCallAccumulator>();

    // Creation and iteration share one try/catch: the OpenAI SDK links `signal` to its own
    // internal AbortController and already swallows an abort *during* iteration (the `for await`
    // loop just ends), but an abort that fires before `create()` resolves rejects the promise —
    // both paths need the same "exit cleanly, don't surface as an error" handling.
    try {
      const stream = await this.openaiClient.chat.completions.create(
        {
          model,
          messages,
          ...(tools !== undefined ? { tools } : {}),
          ...(temperature !== undefined ? { temperature } : {}),
          stream: true,
        },
        { signal },
      );

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        const delta = choice?.delta;

        if (delta?.content) {
          yield { type: StreamEventType.TOKEN, data: delta.content };
        }

        if (delta?.tool_calls) {
          for (const toolCallDelta of delta.tool_calls) {
            const accumulator = toolCallAccumulators.get(toolCallDelta.index) ?? {
              id: '',
              name: '',
              arguments: '',
            };
            if (toolCallDelta.id) accumulator.id = toolCallDelta.id;
            if (toolCallDelta.function?.name) accumulator.name = toolCallDelta.function.name;
            if (toolCallDelta.function?.arguments) {
              accumulator.arguments += toolCallDelta.function.arguments;
            }
            toolCallAccumulators.set(toolCallDelta.index, accumulator);
          }
        }

        if (choice?.finish_reason === 'tool_calls') {
          for (const accumulator of toolCallAccumulators.values()) {
            yield { type: StreamEventType.TOOL_CALL, data: this.toToolCallData(accumulator) };
          }
          toolCallAccumulators.clear();
        }
      }
    } catch (error) {
      if (error instanceof APIUserAbortError || signal?.aborted) {
        return;
      }
      yield { type: StreamEventType.ERROR, data: { error: this.errorMessage(error) } };
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private toToolCallData(accumulator: ToolCallAccumulator): ToolCallData {
    let parsedArguments: Record<string, unknown> = {};
    try {
      parsedArguments = accumulator.arguments ? JSON.parse(accumulator.arguments) : {};
    } catch (error) {
      this.logger.error(
        `Failed to parse streamed tool-call arguments for "${accumulator.name}"`,
        String(error),
      );
    }
    return {
      toolCallId: accumulator.id,
      toolName: accumulator.name,
      arguments: parsedArguments,
    };
  }
}
