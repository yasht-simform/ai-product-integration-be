import {
  HttpException,
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

import { resolveUserId } from '../../../common/utils/resolve-user-id.util';
import { CostBudgetService } from '../services/cost-budget.service';
import type { BudgetCheckResult } from '../types/cost-management.types';

const WARNING_HEADER = 'X-Budget-Warning';

@Injectable()
export class CostBudgetGuard implements CanActivate {
  constructor(
    private readonly costBudgetService: CostBudgetService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.isEnabled()) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const userId = resolveUserId(request);
    if (!userId) return true;

    const result = await this.costBudgetService.checkBudget(userId);

    if (!result.allowed) {
      throw new HttpException(this.buildExceededMessage(result), HttpStatus.TOO_MANY_REQUESTS);
    }

    if (result.warning) {
      const response = context.switchToHttp().getResponse<Response>();
      response.setHeader(WARNING_HEADER, result.warning);
    }

    return true;
  }

  private buildExceededMessage(result: BudgetCheckResult): string {
    if (result.dailyLimit !== null && result.dailySpend >= result.dailyLimit) {
      return `Daily budget exceeded ($${result.dailySpend.toFixed(2)} of $${result.dailyLimit.toFixed(2)})`;
    }
    const monthlyLimit = result.monthlyLimit ?? 0;
    return `Monthly budget exceeded ($${result.monthlySpend.toFixed(2)} of $${monthlyLimit.toFixed(2)})`;
  }

  private isEnabled(): boolean {
    return this.configService.get<boolean>('costBudget.enabled') ?? true;
  }
}
