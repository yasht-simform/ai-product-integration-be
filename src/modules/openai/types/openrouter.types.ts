export interface OpenRouterModel {
  id: string;
  name: string;
  pricing: { prompt: string; completion: string };
  context_length?: number;
}

export interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}
