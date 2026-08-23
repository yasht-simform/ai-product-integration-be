import { StreamEventType } from '../constants/stream-event-type.enum';
import type { StreamEvent } from '../types/ai-chat.types';
import { formatSseFrame } from '../utils/sse-frame.util';

describe('formatSseFrame()', () => {
  it('formats a token event as event/data lines terminated by a blank line', () => {
    const event: StreamEvent = { type: StreamEventType.TOKEN, data: 'Hello' };

    expect(formatSseFrame(event)).toBe('event: token\ndata: "Hello"\n\n');
  });

  it('JSON-encodes object data payloads', () => {
    const event: StreamEvent = {
      type: StreamEventType.TOOL_CALL,
      data: { toolCallId: 'call_1', toolName: 'calculator', arguments: { expression: '2+2' } },
    };

    expect(formatSseFrame(event)).toBe(
      'event: tool_call\ndata: {"toolCallId":"call_1","toolName":"calculator","arguments":{"expression":"2+2"}}\n\n',
    );
  });

  it('formats a done event', () => {
    const event: StreamEvent = {
      type: StreamEventType.DONE,
      data: {
        messageId: 'msg-1',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        estimatedCost: 0.01,
        latencyMs: 250,
      },
    };

    expect(formatSseFrame(event)).toBe(
      'event: done\ndata: {"messageId":"msg-1","usage":{"inputTokens":10,"outputTokens":5,"totalTokens":15},"estimatedCost":0.01,"latencyMs":250}\n\n',
    );
  });

  it('formats an error event', () => {
    const event: StreamEvent = { type: StreamEventType.ERROR, data: { error: 'upstream failure' } };

    expect(formatSseFrame(event)).toBe('event: error\ndata: {"error":"upstream failure"}\n\n');
  });
});
