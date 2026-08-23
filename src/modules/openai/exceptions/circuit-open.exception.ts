import { HttpException, HttpStatus } from '@nestjs/common';

export class CircuitOpenException extends HttpException {
  constructor() {
    super(
      'OpenAI circuit breaker is open — service temporarily unavailable',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
