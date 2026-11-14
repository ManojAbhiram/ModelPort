import { ModelPortError } from './errors.js';
import type { Operation, RunInput } from './types.js';

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/flac'] as const;

export function inputMediaTypes(providerId: string, operation: Operation): readonly string[] {
  if (operation === 'vision') return providerId === 'cerebras' ? ['image/png', 'image/jpeg'] : IMAGE_TYPES;
  if (operation === 'stt') return AUDIO_TYPES;
  return [];
}

export function isBlockedModel(providerId: string, modelId: string): boolean {
  return (providerId === 'groq' && /^groq\/compound(?:-mini)?$/.test(modelId))
    || (providerId === 'openrouter' && (/^openrouter\/auto(?:$|[-:])/.test(modelId) || modelId.endsWith(':online')));
}

export function assertRequestPolicy(providerId: string, input: Pick<RunInput, 'modelId' | 'operation' | 'media'>): void {
  if (isBlockedModel(providerId, input.modelId)) {
    throw new ModelPortError('UNSUPPORTED_MODEL_PROTOCOL', 'Automatic model routing and built-in tool profiles are not supported.', 422);
  }
  if (input.media && !inputMediaTypes(providerId, input.operation).includes(input.media.mimeType)) {
    throw new ModelPortError('UNSUPPORTED_MEDIA', 'The selected provider does not support this input media type.', 422);
  }
}
