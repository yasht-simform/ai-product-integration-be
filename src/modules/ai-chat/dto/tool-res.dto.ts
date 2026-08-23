import { ApiProperty } from '@nestjs/swagger';

import { ToolHandlerType } from '../constants/tool-handler-type.enum';

export class ToolResDto {
  @ApiProperty()
  publicId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  displayName: string;

  @ApiProperty()
  description: string;

  @ApiProperty({ description: 'JSON Schema describing the tool arguments' })
  parameters: Record<string, unknown>;

  @ApiProperty({ enum: ToolHandlerType })
  handlerType: ToolHandlerType;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
