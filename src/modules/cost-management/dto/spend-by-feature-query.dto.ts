import { SpendAnalyticsQueryDto } from './spend-analytics-query.dto';

// Spend-per-feature query — date range only, no pagination (three fixed endpoint→feature buckets).
export class SpendByFeatureQueryDto extends SpendAnalyticsQueryDto {}
