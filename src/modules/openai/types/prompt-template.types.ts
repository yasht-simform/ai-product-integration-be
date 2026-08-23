export interface PromptTemplateEntity {
  publicId: string;
  name: string;
  description: string | null;
  systemPrompt: string;
  fewShotExamples: unknown;
  technique: string;
  recommendedModel: string;
  recommendedTemperature: number;
  tags: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginatedPromptTemplateResult {
  data: PromptTemplateEntity[];
  total: number;
}
