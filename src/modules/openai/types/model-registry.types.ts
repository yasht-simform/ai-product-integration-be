export interface AiProviderEntity {
  publicId: string;
  name: string;
  slug: string;
  baseUrl: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AiProviderWithCount extends AiProviderEntity {
  modelCount: number;
}

export interface AiModelEntity {
  publicId: string;
  providerPublicId: string;
  providerName: string;
  name: string;
  modelId: string;
  tier: string;
  inputPricePer1M: number;
  outputPricePer1M: number;
  contextWindow: number | null;
  description: string | null;
  source: string;
  isActive: boolean;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface QueryModelsParams {
  tier?: string;
  providerId?: string;
  search?: string;
  isActive?: boolean;
  source?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedModelsResult {
  data: AiModelEntity[];
  total: number;
  page: number;
  limit: number;
}

export interface ModelPricingResult {
  input: number;
  output: number;
}

export interface PricingTableModel {
  modelId: string;
  name: string;
  tier: string;
  inputPricePer1M: number;
  outputPricePer1M: number;
}

export interface PricingTableProviderGroup {
  provider: string;
  slug: string;
  models: PricingTableModel[];
}

export interface PricingTableResult {
  providers: PricingTableProviderGroup[];
}

export interface SyncResult {
  providersCreated: number;
  modelsCreated: number;
  modelsUpdated: number;
}

export interface SyncStatusResult {
  lastSyncedAt: Date | null;
  modelsCount: number;
  providersCount: number;
}
