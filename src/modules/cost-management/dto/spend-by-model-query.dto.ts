import { SpendAnalyticsQueryDto } from './spend-analytics-query.dto';

// Spend-per-model query — date range only, no pagination (bounded set of distinct models).
export class SpendByModelQueryDto extends SpendAnalyticsQueryDto {}
