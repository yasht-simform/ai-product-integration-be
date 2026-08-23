import {
  registerDecorator,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidationOptions,
  type ValidatorConstraintInterface,
} from 'class-validator';

import { OpenAIModel } from '../constants/openai-model.enum';

const OPENAI_MODELS: string[] = Object.values(OpenAIModel);

// Matches OpenRouter-style `provider/model-name` or `provider/model-name:variant`,
// e.g. "nvidia/nemotron-3-ultra-550b-a55b:free".
const PROVIDER_MODEL_PATTERN = /^[a-z0-9-]+\/[a-z0-9._-]+(:[a-z0-9-]+)?$/;

@ValidatorConstraint({ name: 'isValidModel', async: false })
export class IsValidModelConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string' || value.length === 0) {
      return false;
    }

    return OPENAI_MODELS.includes(value) || PROVIDER_MODEL_PATTERN.test(value);
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'model must be a valid OpenAI model (gpt-4, gpt-4o, gpt-4o-mini) or a provider/model-name format (e.g. nvidia/nemotron-3-ultra-550b-a55b:free)';
  }
}

export function IsValidModel(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsValidModelConstraint,
    });
  };
}
