import { ToolHandlerType } from './tool-handler-type.enum';

// Seed data for the three built-in tools (spec §8.2/§13.1) — upserted by
// ToolRegistryService.onModuleInit() on every boot, matching OpenRouterSyncService's precedent
// for keeping a registry table populated without a working `prisma/seed.ts` (see CLAUDE.md).
export const BUILTIN_TOOLS = [
  {
    name: 'calculator',
    displayName: 'Calculator',
    description:
      'Evaluate a mathematical expression and return the numeric result. Supports +, -, *, /, sqrt, pow, sin, cos, tan, log, pi, e.',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: "Math expression, e.g. '234 * 567' or 'sqrt(144) + pow(2, 10)'",
        },
      },
      required: ['expression'],
    },
    handlerType: ToolHandlerType.BUILTIN,
  },
  {
    name: 'weather',
    displayName: 'Weather Lookup',
    description:
      'Get current weather for a location including temperature, humidity, wind speed, and conditions.',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: "City name, e.g. 'London' or 'Ahmedabad'" },
        units: {
          type: 'string',
          enum: ['celsius', 'fahrenheit'],
          description: 'Temperature unit',
        },
      },
      required: ['city'],
    },
    handlerType: ToolHandlerType.BUILTIN,
  },
  {
    name: 'datetime',
    displayName: 'Date/Time',
    description:
      'Get the current date, time, and timezone information. Can also calculate date differences.',
    parameters: {
      type: 'object',
      properties: {
        timezone: { type: 'string', description: "IANA timezone, e.g. 'Asia/Kolkata' or 'UTC'" },
        operation: {
          type: 'string',
          enum: ['now', 'diff'],
          description: "Operation: 'now' for current time, 'diff' for date difference",
        },
        date1: { type: 'string', description: 'First date for diff operation (ISO 8601)' },
        date2: { type: 'string', description: 'Second date for diff operation (ISO 8601)' },
      },
      required: ['timezone'],
    },
    handlerType: ToolHandlerType.BUILTIN,
  },
] as const;
