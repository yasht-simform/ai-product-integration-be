import { executeCalculator } from '../tools/calculator.tool';

describe('executeCalculator()', () => {
  it('evaluates basic arithmetic', () => {
    expect(executeCalculator({ expression: '234 * 567' })).toEqual({ result: 132678 });
  });

  it('evaluates functions like sqrt and pow', () => {
    expect(executeCalculator({ expression: 'sqrt(144) + pow(2, 10)' })).toEqual({
      result: 1036,
    });
  });

  it('throws a catchable error for a malformed expression (unclosed paren)', () => {
    expect(() => executeCalculator({ expression: '(1 + 2' })).toThrow();
  });

  it('throws a catchable error for a non-math function call, never executing it', () => {
    expect(() => executeCalculator({ expression: "alert('x')" })).toThrow();
  });

  it('rejects an empty expression', () => {
    expect(() => executeCalculator({ expression: '' })).toThrow('expression is required');
  });

  it('rejects an expression over the length cap', () => {
    const longExpression = '1+'.repeat(150);
    expect(() => executeCalculator({ expression: longExpression })).toThrow(
      /exceeds maximum length/,
    );
  });

  it('rejects an expression that does not evaluate to a finite number', () => {
    expect(() => executeCalculator({ expression: '1/0' })).toThrow(
      /did not evaluate to a finite number/,
    );
  });
});
