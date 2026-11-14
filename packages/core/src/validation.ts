import { z } from 'zod';
import { ModelPortError } from './errors.js';
import { AUDIO_TYPES, IMAGE_TYPES } from './policy.js';
import { OPERATIONS } from './types.js';
import type { ConnectionConfig, MediaInput, Operation, ProviderDefinition, RunInput } from './types.js';

export const MAX_MEDIA_BYTES = 4 * 1024 * 1024;
export const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 16_777_216;
export { AUDIO_TYPES, IMAGE_TYPES } from './policy.js';

const modelId = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+\-]*$/);
const configSchema = z.strictObject({
  providerId: z.string().min(1).max(60),
  name: z.string().trim().min(1).max(80).optional(),
  apiKey: z.string().trim().min(1).max(4096).regex(/^[\x21-\x7e]+$/).optional(),
  baseUrl: z.string().trim().max(1024).optional(),
  workspaceId: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/).optional(),
});
const runSchema = z.strictObject({
  connectionId: z.string().uuid(),
  modelId,
  operation: z.enum(OPERATIONS),
  text: z.string().min(1).max(16_000).optional(),
  media: z.strictObject({
    data: z.string().min(1).max(Math.ceil(MAX_MEDIA_BYTES / 3) * 4),
    mimeType: z.enum([...IMAGE_TYPES, ...AUDIO_TYPES]),
  }).optional(),
  voice: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/).optional(),
  maxOutputTokens: z.number().int().min(1).max(4096).optional(),
});
const declarationSchema = z.strictObject({
  id: modelId,
  operations: z.array(z.enum(OPERATIONS)).min(1).max(OPERATIONS.length),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ModelPortError('INVALID_INPUT', 'Invalid request. Check required fields, supported options, and input limits.');
  }
  return result.data;
}

export function normalizeConfig(value: ConnectionConfig, provider: ProviderDefinition): ConnectionConfig {
  const config = parse(configSchema, value);
  if (provider.status !== 'ready' || !provider.adapter) {
    throw new ModelPortError('PROVIDER_PLANNED', 'This provider is on the roadmap and is not executable in this version.', 422);
  }
  if (provider.kind === 'cloud' && provider.auth !== 'none' && !config.apiKey) {
    throw new ModelPortError('KEY_REQUIRED', 'Enter a provider API key. Credentials are kept only in server memory.');
  }
  if (config.workspaceId && provider.id !== 'anthropic') {
    throw new ModelPortError('INVALID_INPUT', 'Workspace IDs are only supported by the Anthropic adapter.');
  }
  let url: URL;
  try {
    url = new URL(config.baseUrl || provider.baseUrl);
  } catch {
    throw new ModelPortError('UNSAFE_ENDPOINT', 'The endpoint must be a valid URL.');
  }
  if (url.username || url.password || url.search || url.hash || (config.baseUrl || '').includes('#')) {
    throw new ModelPortError('UNSAFE_ENDPOINT', 'Endpoint credentials, query parameters, and fragments are not allowed.');
  }
  if (provider.kind === 'local') {
    if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    const expectedPath = new URL(provider.baseUrl).pathname.replace(/\/$/, '');
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !['127.0.0.1', '[::1]'].includes(url.hostname) ||
      port < 1024 || port > 65535 ||
      url.pathname.replace(/\/$/, '') !== expectedPath
    ) {
      throw new ModelPortError('UNSAFE_ENDPOINT', `Local endpoints require literal loopback, a port from 1024 to 65535, and the base path ${expectedPath || '/'}.`);
    }
  } else if (url.href.replace(/\/$/, '') !== provider.baseUrl.replace(/\/$/, '')) {
    throw new ModelPortError('UNSAFE_ENDPOINT', 'Cloud provider endpoints are pinned. Arbitrary cloud URLs are not accepted.');
  }
  return { ...config, name: config.name || provider.name, baseUrl: url.href.replace(/\/$/, '') };
}

function imageDimensions(bytes: Buffer, mimeType: string): [number, number] {
  if (mimeType === 'image/png') {
    if (bytes.length < 33 || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') {
      throw new ModelPortError('INVALID_MEDIA', 'The PNG header is malformed.');
    }
    let position = 8;
    let chunks = 0;
    while (position + 12 <= bytes.length && chunks++ < 10_000) {
      const length = bytes.readUInt32BE(position);
      if (length > bytes.length - position - 12) throw new ModelPortError('INVALID_MEDIA', 'The PNG contains a truncated chunk.');
      if (bytes.toString('ascii', position + 4, position + 8) === 'acTL') {
        throw new ModelPortError('INVALID_MEDIA', 'Animated images are not supported.');
      }
      position += length + 12;
    }
    if (chunks >= 10_000) throw new ModelPortError('INVALID_MEDIA', 'The PNG contains too many chunks.');
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  if (mimeType === 'image/webp') {
    if (bytes.length < 25 || bytes.readUInt32LE(4) + 8 !== bytes.length) {
      throw new ModelPortError('INVALID_MEDIA', 'The WebP header is malformed.');
    }
    const chunk = bytes.toString('ascii', 12, 16);
    if (chunk === 'VP8X' && bytes.length >= 30) {
      if ((bytes[20]! & 2) !== 0) throw new ModelPortError('INVALID_MEDIA', 'Animated images are not supported.');
      return [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1];
    }
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21);
      return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
    }
    if (chunk === 'VP8 ' && bytes.length >= 30 && bytes.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
      return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
    }
    throw new ModelPortError('INVALID_MEDIA', 'The WebP image dimensions could not be validated.');
  }
  let position = 2;
  const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (position + 4 <= bytes.length) {
    if (bytes[position] !== 0xff) break;
    while (bytes[position] === 0xff) position++;
    const marker = bytes[position++];
    if (marker === undefined || marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (position + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(position);
    if (length < 2 || position + length > bytes.length) break;
    if (frameMarkers.has(marker) && length >= 8) {
      return [bytes.readUInt16BE(position + 5), bytes.readUInt16BE(position + 3)];
    }
    position += length;
  }
  throw new ModelPortError('INVALID_MEDIA', 'The JPEG image dimensions could not be validated.');
}

export function validateMedia(media: MediaInput, maximum = MAX_MEDIA_BYTES): number {
  if (typeof media.data !== 'string' || media.data.length > Math.ceil(maximum / 3) * 4) {
    throw new ModelPortError('MEDIA_TOO_LARGE', `Media must not exceed ${Math.floor(maximum / 1024 / 1024)} MiB.`);
  }
  const bytes = Buffer.from(media.data, 'base64');
  if (!bytes.length || bytes.length > maximum || bytes.toString('base64') !== media.data) {
    throw new ModelPortError('INVALID_MEDIA', 'Media must be nonempty, canonical base64 within the size limit.');
  }
  const starts = (signature: number[]) => bytes.subarray(0, signature.length).equals(Buffer.from(signature));
  const ascii = (start: number, end: number) => bytes.toString('ascii', start, end);
  const signatures: Record<string, boolean> = {
    'image/png': starts([137, 80, 78, 71, 13, 10, 26, 10]),
    'image/jpeg': starts([255, 216, 255]),
    'image/webp': ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP',
    'audio/wav': ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE',
    'audio/mpeg': ascii(0, 3) === 'ID3' || (bytes[0] === 0xff && ((bytes[1] || 0) & 0xe0) === 0xe0),
    'audio/ogg': ascii(0, 4) === 'OggS',
    'audio/webm': starts([0x1a, 0x45, 0xdf, 0xa3]),
    'audio/flac': ascii(0, 4) === 'fLaC',
  };
  if (!Object.hasOwn(signatures, media.mimeType) || signatures[media.mimeType] !== true) {
    throw new ModelPortError('INVALID_MEDIA', 'The file signature does not match a supported media type.');
  }
  if (media.mimeType.startsWith('image/')) {
    const [width, height] = imageDimensions(bytes, media.mimeType);
    if (width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > MAX_IMAGE_PIXELS) {
      throw new ModelPortError('IMAGE_DIMENSIONS', 'Images must be at most 8192 pixels per side and 16 megapixels in total.');
    }
  }
  return bytes.length;
}

export function validateRun(value: RunInput): RunInput {
  const input = parse(runSchema, value);
  const needsText = input.operation !== 'stt';
  if (needsText && !input.text?.trim()) throw new ModelPortError('TEXT_REQUIRED', 'This operation requires nonempty text.');
  if (input.operation === 'stt' && input.text) throw new ModelPortError('INVALID_INPUT', 'Transcription accepts an audio file, not an additional prompt.');
  const needsMedia = input.operation === 'vision' || input.operation === 'stt';
  if (needsMedia !== Boolean(input.media)) throw new ModelPortError('MEDIA_REQUIRED', needsMedia ? 'This operation requires a media file.' : 'This operation does not accept a media file.');
  if (input.media) {
    validateMedia(input.media);
    const prefix = input.operation === 'vision' ? 'image/' : 'audio/';
    if (!input.media.mimeType.startsWith(prefix)) throw new ModelPortError('INVALID_MEDIA', `This operation requires ${prefix === 'image/' ? 'an image' : 'an audio file'}.`);
  }
  if (input.voice && input.operation !== 'tts') throw new ModelPortError('INVALID_INPUT', 'A voice can only be selected for text-to-speech.');
  if (input.maxOutputTokens !== undefined && !['text', 'vision'].includes(input.operation)) {
    throw new ModelPortError('INVALID_INPUT', 'A token limit only applies to text and image-understanding output.');
  }
  if (['text', 'vision'].includes(input.operation)) input.maxOutputTokens = input.maxOutputTokens ?? 512;
  return input;
}

export function validateDeclaration(value: { id: string; operations: Operation[] }) {
  const declaration = parse(declarationSchema, value);
  declaration.operations = [...new Set(declaration.operations)];
  return declaration;
}
