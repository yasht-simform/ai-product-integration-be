import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { APIUserAbortError } from 'openai';

import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { OPENAI_CLIENT } from '../../openai/constants/injection-tokens';
import { StreamEventType } from '../constants/stream-event-type.enum';
import { StreamingService } from '../services/streaming.service';
import type { StreamEvent, ToolCallData } from '../types/ai-chat.types';

const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

const mockOpenAIClient = {
  chat: { completions: { create: jest.fn() } },
};

// Mirrors the OpenAI SDK's Stream<ChatCompletionChunk> async-iterable shape without any
// real transport — AI-029 will need the same shape for its own streaming tests.
function toAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        next: (): Promise<IteratorResult<T>> => {
          if (index < items.length) {
            return Promise.resolve({ value: items[index++], done: false });
          }
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
}

async function drain<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of gen) {
    values.push(value);
  }
  return values;
}

function chunk(delta: Record<string, unknown>, finishReason: string | null = null) {
  return { choices: [{ delta, finish_reason: finishReason }] };
}

describe('StreamingService', () => {
  let service: StreamingService;

  beforeEach(async () => {
    const configMock = {
      get: jest.fn().mockReturnValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StreamingService,
        { provide: OPENAI_CLIENT, useValue: mockOpenAIClient },
        { provide: ConfigService, useValue: configMock },
        { provide: AppLoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<StreamingService>(StreamingService);
    jest.clearAllMocks();
  });

  it('yields a token event for every chunk with delta.content', async () => {
    mockOpenAIClient.chat.completions.create.mockResolvedValue(
      toAsyncIterable([
        chunk({ content: 'Hello' }),
        chunk({ content: ', ' }),
        chunk({ content: 'world!' }),
        chunk({}, 'stop'),
      ]),
    );

    const events = await drain(service.streamCompletion([{ role: 'user', content: 'hi' }]));

    expect(events).toEqual<StreamEvent[]>([
      { type: StreamEventType.TOKEN, data: 'Hello' },
      { type: StreamEventType.TOKEN, data: ', ' },
      { type: StreamEventType.TOKEN, data: 'world!' },
    ]);
  });

  it('concatenating token event data reproduces the exact full response content', async () => {
    const fullContent = 'The answer is 42.';
    const fragments = ['The ', 'answer ', 'is ', '42.'];
    mockOpenAIClient.chat.completions.create.mockResolvedValue(
      toAsyncIterable([...fragments.map((f) => chunk({ content: f })), chunk({}, 'stop')]),
    );

    const events = await drain(service.streamCompletion([{ role: 'user', content: 'hi' }]));
    const concatenated = events
      .filter((e) => e.type === StreamEventType.TOKEN)
      .map((e) => e.data as string)
      .join('');

    expect(concatenated).toBe(fullContent);
  });

  it('accumulates a tool call split across multiple chunks and yields one tool_call event', async () => {
    mockOpenAIClient.chat.completions.create.mockResolvedValue(
      toAsyncIterable([
        chunk({
          tool_calls: [
            {
              index: 0,
              id: 'call_1',
              type: 'function',
              function: { name: 'calculator', arguments: '' },
            },
          ],
        }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '{"exp' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: 'ression":"2+2' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '"}' } }] }, 'tool_calls'),
      ]),
    );

    const events = await drain(
      service.streamCompletion([{ role: 'user', content: 'what is 2+2' }]),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual<StreamEvent>({
      type: StreamEventType.TOOL_CALL,
      data: {
        toolCallId: 'call_1',
        toolName: 'calculator',
        arguments: { expression: '2+2' },
      } satisfies ToolCallData,
    });
  });

  it('yields one tool_call event per tool when multiple tools are called concurrently', async () => {
    mockOpenAIClient.chat.completions.create.mockResolvedValue(
      toAsyncIterable([
        chunk({
          tool_calls: [
            {
              index: 0,
              id: 'call_1',
              type: 'function',
              function: { name: 'calculator', arguments: '{}' },
            },
            {
              index: 1,
              id: 'call_2',
              type: 'function',
              function: { name: 'datetime', arguments: '{}' },
            },
          ],
        }),
        chunk({}, 'tool_calls'),
      ]),
    );

    const events = await drain(service.streamCompletion([{ role: 'user', content: 'hi' }]));

    expect(events).toHaveLength(2);
    expect(events.map((e) => (e.data as ToolCallData).toolName)).toEqual([
      'calculator',
      'datetime',
    ]);
  });

  it('falls back to an empty object when accumulated tool-call arguments are not valid JSON', async () => {
    mockOpenAIClient.chat.completions.create.mockResolvedValue(
      toAsyncIterable([
        chunk({
          tool_calls: [
            {
              index: 0,
              id: 'call_1',
              type: 'function',
              function: { name: 'calculator', arguments: 'not-json' },
            },
          ],
        }),
        chunk({}, 'tool_calls'),
      ]),
    );

    const events = await drain(service.streamCompletion([{ role: 'user', content: 'hi' }]));

    expect((events[0]?.data as ToolCallData).arguments).toEqual({});
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('passes model, tools, and temperature through to the OpenAI SDK with stream: true', async () => {
    mockOpenAIClient.chat.completions.create.mockResolvedValue(
      toAsyncIterable([chunk({}, 'stop')]),
    );
    const tools = [{ type: 'function' as const, function: { name: 'calculator', parameters: {} } }];

    await drain(
      service.streamCompletion([{ role: 'user', content: 'hi' }], {
        model: 'gpt-4o',
        temperature: 0.5,
        tools,
      }),
    );

    expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
      {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hi' }],
        tools,
        temperature: 0.5,
        stream: true,
      },
      { signal: undefined },
    );
  });

  it('falls back to the configured default model when none is provided', async () => {
    const configMock = { get: jest.fn().mockReturnValue('meta-llama/llama-3.3-70b-instruct:free') };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StreamingService,
        { provide: OPENAI_CLIENT, useValue: mockOpenAIClient },
        { provide: ConfigService, useValue: configMock },
        { provide: AppLoggerService, useValue: mockLogger },
      ],
    }).compile();
    const svc = module.get<StreamingService>(StreamingService);
    mockOpenAIClient.chat.completions.create.mockResolvedValue(
      toAsyncIterable([chunk({}, 'stop')]),
    );

    await drain(svc.streamCompletion([{ role: 'user', content: 'hi' }]));

    expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'meta-llama/llama-3.3-70b-instruct:free' }),
      expect.anything(),
    );
  });

  it('passes the abort signal through to the OpenAI SDK request options', async () => {
    mockOpenAIClient.chat.completions.create.mockResolvedValue(
      toAsyncIterable([chunk({}, 'stop')]),
    );
    const controller = new AbortController();

    await drain(
      service.streamCompletion([{ role: 'user', content: 'hi' }], { signal: controller.signal }),
    );

    expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(expect.anything(), {
      signal: controller.signal,
    });
  });

  it('exits cleanly without an error event when the request is aborted before the stream resolves', async () => {
    const controller = new AbortController();
    mockOpenAIClient.chat.completions.create.mockRejectedValue(new APIUserAbortError());
    controller.abort();

    const events = await drain(
      service.streamCompletion([{ role: 'user', content: 'hi' }], { signal: controller.signal }),
    );

    expect(events).toEqual([]);
  });

  it('yields an error event and stops when a non-abort error occurs mid-stream', async () => {
    mockOpenAIClient.chat.completions.create.mockResolvedValue(
      toAsyncIterable([
        chunk({ content: 'partial' }),
        {
          choices: [
            {
              delta: {},
              get finish_reason() {
                throw new Error('upstream API failure');
              },
            },
          ],
        },
      ]),
    );

    const events = await drain(service.streamCompletion([{ role: 'user', content: 'hi' }]));

    expect(events).toEqual([
      { type: StreamEventType.TOKEN, data: 'partial' },
      { type: StreamEventType.ERROR, data: { error: 'upstream API failure' } },
    ]);
  });
});
