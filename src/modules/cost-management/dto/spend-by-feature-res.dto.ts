import { ApiProperty } from '@nestjs/swagger';

export class SpendByFeatureRowResDto {
  @ApiProperty({
    description:
      "Mapped feature label ('chat', 'embeddings', 'moderations'). Chat completions serve both " +
      'plain chat and RAG answer generation — the two are not distinguishable from ai_audit_logs ' +
      "columns alone, so RAG-driven spend is folded into 'chat'.",
  })
  feature: string;

  @ApiProperty({ description: 'Raw ai_audit_logs endpoint value this row was grouped from' })
  endpoint: string;

  @ApiProperty()
  totalCost: number;

  @ApiProperty()
  totalTokens: number;

  @ApiProperty()
  callCount: number;
}

export class SpendByFeatureResDto {
  @ApiProperty({ type: () => [SpendByFeatureRowResDto] })
  data: SpendByFeatureRowResDto[];
}
