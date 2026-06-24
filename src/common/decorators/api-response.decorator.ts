import { applyDecorators, type Type } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

// ── Options ───────────────────────────────────────────────────────────────────

export interface ApiEndpointOptions {
  /** Short one-line summary shown in the Swagger operation header. */
  summary: string;
  /** Optional longer description rendered in the operation detail panel. */
  description?: string;
  /**
   * DTO class for the success response body.
   * Wrap in a tuple to mark the response as an array:
   *   type: UserDto        → { ...user fields }
   *   type: [UserDto]      → [{ ...user fields }, ...]
   */
  type?: Type<unknown> | [Type<unknown>];
  /**
   * HTTP status code for the success response.
   * @default 200
   */
  successStatus?: 200 | 201;
  /**
   * Mark the endpoint as publicly accessible (no JWT required).
   * When true, the 401 / 403 responses and the bearer auth header
   * are omitted from the generated docs.
   * @default false
   */
  isPublic?: boolean;
}

// ── Composite decorator ───────────────────────────────────────────────────────

/**
 * Drop-in replacement for the repetitive Swagger boilerplate on every route.
 *
 * Applies in one call:
 *  - @ApiOperation  — summary + description
 *  - @ApiOkResponse / @ApiCreatedResponse — typed success body (when `type` provided)
 *  - @ApiBearerAuth — JWT auth header (skipped when isPublic: true)
 *  - @ApiBadRequestResponse    — 400
 *  - @ApiUnauthorizedResponse  — 401 (skipped when isPublic: true)
 *  - @ApiForbiddenResponse     — 403 (skipped when isPublic: true)
 *  - @ApiInternalServerErrorResponse — 500
 *
 * Usage:
 *   @ApiEndpoint({ summary: 'Get current user', type: UserDto })
 *   @ApiEndpoint({ summary: 'Register', successStatus: 201, type: AuthResponseDto, isPublic: true })
 *   @ApiEndpoint({ summary: 'Public feed', type: [PostDto], isPublic: true })
 */
export const ApiEndpoint = (options: ApiEndpointOptions) => {
  const { summary, description, type, successStatus = 200, isPublic = false } = options;

  const decorators: Array<ClassDecorator | MethodDecorator | PropertyDecorator> = [
    ApiOperation({ summary, description }),
    ApiBadRequestResponse({ description: 'Validation failed or malformed request body' }),
    ApiInternalServerErrorResponse({ description: 'Unexpected server error' }),
  ];

  // Auth-required routes get the bearer header + 401/403 docs.
  if (!isPublic) {
    decorators.push(
      ApiBearerAuth('access-token'),
      ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' }),
      ApiForbiddenResponse({ description: 'Insufficient permissions' }),
    );
  }

  // Typed success response — resolves array tuple syntax.
  if (type !== undefined) {
    const isArray = Array.isArray(type);
    const resolvedType = isArray ? type[0] : type;

    const responseDecorator =
      successStatus === 201
        ? ApiCreatedResponse({ type: resolvedType, isArray })
        : ApiOkResponse({ type: resolvedType, isArray });

    decorators.push(responseDecorator);
  }

  return applyDecorators(...decorators);
};
