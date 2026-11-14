import { describe, expect, it } from 'vitest';
import { detectedMediaType, MAX_UPLOAD_BYTES, outputBlob, readUpload } from '../media';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const webp = 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';

describe('local media handling', () => {
  it('uses the file signature rather than trusting the file extension or reported MIME', async () => {
    const bytes = Uint8Array.from(atob(png), (character) => character.charCodeAt(0));
    const upload = await readUpload(new File([bytes], 'image.dat', { type: 'application/octet-stream' }), 'image');
    expect(upload.media).toEqual({ mimeType: 'image/png', data: png });
    expect(upload.bytes).toBe(bytes.length);
  });

  it('rejects empty, oversized, wrong-kind, and unsupported files', async () => {
    await expect(readUpload(new File([], 'empty.png'), 'image')).rejects.toThrow('empty');
    await expect(readUpload(new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], 'large.wav'), 'audio')).rejects.toThrow('4 MiB');
    await expect(readUpload(new File(['OggSstream'], 'audio.ogg'), 'image')).rejects.toThrow('PNG, JPEG, or WebP');
    await expect(readUpload(new File(['<svg />'], 'image.png', { type: 'image/png' }), 'image')).rejects.toThrow('file signature');
  });

  it('rejects WebP locally for Cerebras even when the file claims to be PNG', async () => {
    const bytes = Uint8Array.from(atob(webp), (character) => character.charCodeAt(0));
    await expect(readUpload(new File([bytes], 'pixel.webp', { type: 'image/webp' }), 'image', 'cerebras')).rejects.toThrow('PNG or JPEG');
    await expect(readUpload(new File([bytes], 'pixel.png', { type: 'image/png' }), 'image', 'cerebras')).rejects.toThrow('PNG or JPEG');
  });

  it('retains WebP support for other providers and existing calls without a provider', async () => {
    const bytes = Uint8Array.from(atob(webp), (character) => character.charCodeAt(0));
    const file = new File([bytes], 'pixel.webp', { type: 'image/webp' });
    for (const providerId of [undefined, 'openai', 'unknown-provider']) {
      expect((await readUpload(file, 'image', providerId)).media).toEqual({ mimeType: 'image/webp', data: webp });
    }
  });

  it.each([
    ['image/png', png], ['image/jpeg', '/9j/'],
  ])('accepts the supported %s signature for Cerebras', async (mimeType, data) => {
    const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
    expect((await readUpload(new File([bytes], 'image.dat'), 'image', 'cerebras')).media).toEqual({ mimeType, data });
  });

  it.each([
    ['OggSstream', 'audio/ogg'], ['fLaCaudio', 'audio/flac'], ['ID3audio', 'audio/mpeg'],
    ['RIFF0000WAVEdata', 'audio/wav'], ['RIFF0000WEBPdata', 'image/webp'],
  ])('identifies supported signatures without external downloads: %s', (content, type) => {
    expect(detectedMediaType(new TextEncoder().encode(content))).toBe(type);
  });

  it('creates a local typed Blob, never a provider URL', async () => {
    const blob = outputBlob({ mimeType: 'image/png', data: png });
    expect(blob.type).toBe('image/png');
    expect(new Uint8Array(await blob.arrayBuffer()).length).toBe(atob(png).length);
    expect(() => outputBlob({ mimeType: 'image/png', data: 'https://example.com/image.png' })).toThrow();
  });

  it.each(['image/svg+xml', 'text/html', 'application/octet-stream'])('does not render active or unsupported media: %s', (mimeType) => {
    expect(() => outputBlob({ mimeType, data: btoa('<script>throw 1</script>') })).toThrow('cannot safely display');
  });
});
