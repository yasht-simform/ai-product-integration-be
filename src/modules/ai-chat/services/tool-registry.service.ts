import {
  ConflictException,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type OpenAI from 'openai';

import type { ChatTool, Prisma } from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { BUILTIN_TOOLS } from '../constants/builtin-tools.constant';
import type { CreateToolDto } from '../dto/create-tool.dto';
import type { UpdateToolDto } from '../dto/update-tool.dto';
import type { ToolEntity } from '../types/ai-chat.types';

@Injectable()
export class ToolRegistryService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly logger: AppLoggerService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await Promise.all(
        BUILTIN_TOOLS.map((tool) =>
          this.db.chatTool.upsert({
            where: { name: tool.name },
            create: {
              name: tool.name,
              displayName: tool.displayName,
              description: tool.description,
              parameters: tool.parameters,
              handlerType: tool.handlerType,
            },
            update: {
              displayName: tool.displayName,
              description: tool.description,
              parameters: tool.parameters,
              handlerType: tool.handlerType,
            },
          }),
        ),
      );
      this.logger.log(`Seeded ${BUILTIN_TOOLS.length} built-in tools`);
    } catch (error) {
      this.logger.error('Built-in tool seeding failed', String(error));
    }
  }

  async findAllTools(): Promise<ToolEntity[]> {
    const tools = await this.db.chatTool.findMany({ orderBy: { name: 'asc' } });
    return tools.map((t) => this.toToolEntity(t));
  }

  async findActiveTool(name: string): Promise<ToolEntity> {
    const tool = await this.db.chatTool.findUnique({ where: { name } });
    if (!tool || !tool.isActive) {
      throw new NotFoundException(`Tool "${name}" not found or inactive`);
    }
    return this.toToolEntity(tool);
  }

  async createTool(dto: CreateToolDto): Promise<ToolEntity> {
    try {
      const tool = await this.db.chatTool.create({
        data: {
          name: dto.name,
          displayName: dto.displayName,
          description: dto.description,
          parameters: dto.parameters as Prisma.InputJsonValue,
          handlerType: dto.handlerType,
          handlerConfig: dto.handlerConfig as Prisma.InputJsonValue,
        },
      });
      return this.toToolEntity(tool);
    } catch (error) {
      if (this.isP2002(error)) {
        throw new ConflictException(`Tool with name "${dto.name}" already exists`);
      }
      throw error;
    }
  }

  async updateTool(publicId: string, dto: UpdateToolDto): Promise<ToolEntity> {
    await this.findToolByPublicId(publicId);

    const tool = await this.db.chatTool.update({
      where: { publicId },
      data: {
        name: dto.name,
        displayName: dto.displayName,
        description: dto.description,
        parameters: dto.parameters as Prisma.InputJsonValue | undefined,
        handlerType: dto.handlerType,
        handlerConfig: dto.handlerConfig as Prisma.InputJsonValue | undefined,
      },
    });
    return this.toToolEntity(tool);
  }

  async deleteTool(publicId: string): Promise<void> {
    await this.findToolByPublicId(publicId);
    await this.db.chatTool.update({ where: { publicId }, data: { isActive: false } });
  }

  async getToolDefinitions(): Promise<OpenAI.Chat.ChatCompletionTool[]> {
    const tools = await this.db.chatTool.findMany({ where: { isActive: true } });
    return tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters as Record<string, unknown>,
      },
    }));
  }

  private async findToolByPublicId(publicId: string): Promise<ToolEntity> {
    const tool = await this.db.chatTool.findUnique({ where: { publicId } });
    if (!tool) throw new NotFoundException(`Tool "${publicId}" not found`);
    return this.toToolEntity(tool);
  }

  private toToolEntity(tool: ChatTool): ToolEntity {
    return {
      publicId: tool.publicId,
      name: tool.name,
      displayName: tool.displayName,
      description: tool.description,
      parameters: tool.parameters as Record<string, unknown>,
      handlerType: tool.handlerType,
      handlerConfig: tool.handlerConfig as Record<string, unknown> | null,
      isActive: tool.isActive,
      createdAt: tool.createdAt,
      updatedAt: tool.updatedAt,
    };
  }

  private isP2002(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}
