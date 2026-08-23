import { IsValidModelConstraint } from '../validators/is-valid-model.validator';

describe('IsValidModelConstraint', () => {
  let constraint: IsValidModelConstraint;

  beforeEach(() => {
    constraint = new IsValidModelConstraint();
  });

  describe('valid models', () => {
    it.each([
      'gpt-4',
      'gpt-4o',
      'gpt-4o-mini',
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'meta-llama/llama-4-maverick:free',
      'openai/gpt-oss-120b:free',
      'deepseek/deepseek-chat-v3-0324:free',
    ])('accepts "%s"', (value) => {
      expect(constraint.validate(value)).toBe(true);
    });
  });

  describe('invalid models', () => {
    it.each(['', 'not a model', 'has spaces/model', 'UPPERCASE/model'])('rejects "%s"', (value) => {
      expect(constraint.validate(value)).toBe(false);
    });

    it('rejects non-string values', () => {
      expect(constraint.validate(undefined)).toBe(false);
      expect(constraint.validate(null)).toBe(false);
      expect(constraint.validate(123)).toBe(false);
    });
  });

  describe('defaultMessage', () => {
    it('returns a message explaining the accepted formats', () => {
      expect(constraint.defaultMessage({} as never)).toBe(
        'model must be a valid OpenAI model (gpt-4, gpt-4o, gpt-4o-mini) or a provider/model-name format (e.g. nvidia/nemotron-3-ultra-550b-a55b:free)',
      );
    });
  });
});
