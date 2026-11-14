import { describe, expect, it } from 'vitest';
import { getProvider } from '../src/catalog.js';
import { MAX_MEDIA_BYTES, normalizeConfig, validateMedia, validateRun } from '../src/validation.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/i9sAAAAASUVORK5CYII=';
const connectionId = '9416e296-fac7-487d-9c33-3f40dbcd7b72';

describe('endpoint validation', () => {
  it('pins official provider origins and paths', () => {
    expect(normalizeConfig({ providerId: 'openai', apiKey: 'test-key' }, getProvider('openai')).baseUrl).toBe('https://api.openai.com/v1');
    expect(() => normalizeConfig({ providerId: 'openai', apiKey: 'test-key', baseUrl: 'https://evil.example/v1' }, getProvider('openai'))).toThrow(/pinned/);
  });

  it('canonicalizes localhost without requiring a DNS lookup', () => {
    expect(normalizeConfig({ providerId: 'ollama', baseUrl: 'http://localhost:11434' }, getProvider('ollama')).baseUrl).toBe('http://127.0.0.1:11434');
  });

  it.each([
    'http://169.254.169.254:11434', 'http://192.168.1.1:11434', 'http://localhost.evil.test:11434',
    'http://127.0.0.1:80', 'http://127.0.0.1:11434/other', 'http://user:pass@127.0.0.1:11434',
    'file:///etc/passwd', 'http://127.0.0.1:11434?key=secret', 'http://127.0.0.1:11434#secret',
  ])('rejects unsafe local endpoint %s', (baseUrl) => {
    expect(() => normalizeConfig({ providerId: 'ollama', baseUrl }, getProvider('ollama'))).toThrow();
  });

  it('rejects header injection and unknown config fields', () => {
    expect(() => normalizeConfig({ providerId: 'openai', apiKey: 'secret\r\nX-Injected:yes' }, getProvider('openai'))).toThrow(/Invalid request/);
    expect(() => normalizeConfig({ providerId: 'openai', apiKey: 'test', endpoint: 'evil' } as never, getProvider('openai'))).toThrow(/Invalid request/);
  });
});

describe('bounded inline media', () => {
  it('accepts a small signature-checked raster image', () => {
    expect(validateMedia({ data: png, mimeType: 'image/png' })).toBe(Buffer.from(png, 'base64').length);
  });

  it('rejects SVG, mismatched signatures, noncanonical base64 and excessive size', () => {
    expect(() => validateMedia({ data: Buffer.from('<svg/>').toString('base64'), mimeType: 'image/svg+xml' })).toThrow(/signature/);
    expect(() => validateMedia({ data: png, mimeType: 'image/jpeg' })).toThrow(/signature/);
    expect(() => validateMedia({ data: `${png}\n`, mimeType: 'image/png' })).toThrow(/canonical/);
    expect(() => validateMedia({ data: 'a'.repeat(Math.ceil(MAX_MEDIA_BYTES / 3) * 4 + 1), mimeType: 'image/png' })).toThrow(/exceed/);
  });

  it.each(['constructor', '__proto__', 'toString'])('rejects inherited MIME property %s', (mimeType) => {
    expect(() => validateMedia({ data: Buffer.from('not media').toString('base64'), mimeType })).toThrow(/signature/);
  });

  it('rejects oversized dimensions and animated PNG headers', () => {
    const bytes = Buffer.from(png, 'base64');
    bytes.writeUInt32BE(100_000, 16);
    expect(() => validateMedia({ data: bytes.toString('base64'), mimeType: 'image/png' })).toThrow(/megapixels/);
    const animated = Buffer.from(png, 'base64');
    animated.write('acTL', 37, 'ascii');
    expect(() => validateMedia({ data: animated.toString('base64'), mimeType: 'image/png' })).toThrow(/Animated/);
  });

  it('only accepts media appropriate for the selected operation', () => {
    expect(() => validateRun({ connectionId, modelId: 'test', operation: 'stt', media: { data: png, mimeType: 'image/png' } })).toThrow(/audio file/);
    expect(() => validateRun({ connectionId, modelId: 'test', operation: 'text', text: 'Hi', media: { data: png, mimeType: 'image/png' } })).toThrow(/does not accept/);
    expect(() => validateRun({ connectionId, modelId: 'test', operation: 'embedding', text: 'Hi', maxOutputTokens: 10 })).toThrow(/token limit/);
  });
});
