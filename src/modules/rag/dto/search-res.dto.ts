import { ApiProperty } from '@nestjs/swagger';

import { SearchResultResDto } from './search-result-res.dto';

export class SearchResDto {
  @ApiProperty({ type: () => [SearchResultResDto] })
  results: SearchResultResDto[];

  @ApiProperty()
  totalResults: number;

  @ApiProperty()
  searchLatencyMs: number;
}
