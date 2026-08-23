import { buildStaticModerationResponse } from '../utils/static-moderation-fixture.util';

describe('buildStaticModerationResponse() (AI-059 static mode)', () => {
  it('returns a flagged fixture result for text containing a flagged keyword', () => {
    const response = buildStaticModerationResponse('I want to hurt someone');

    expect(response.results).toHaveLength(1);
    expect(response.results[0].flagged).toBe(true);
    expect(response.model).toBe('static-fixture-moderation');
  });

  it('returns a clean fixture result for text with no flagged keyword', () => {
    const response = buildStaticModerationResponse('What a lovely day for a walk');

    expect(response.results).toHaveLength(1);
    expect(response.results[0].flagged).toBe(false);
  });

  it('matches keywords case-insensitively', () => {
    const response = buildStaticModerationResponse('I will KILL the process');

    expect(response.results[0].flagged).toBe(true);
  });

  it('maps a batch of inputs to one result per item, preserving order', () => {
    const response = buildStaticModerationResponse([
      'a lovely day',
      'a violent threat to attack',
      'another clean sentence',
    ]);

    expect(response.results).toHaveLength(3);
    expect(response.results.map((r) => r.flagged)).toEqual([false, true, false]);
  });
});
