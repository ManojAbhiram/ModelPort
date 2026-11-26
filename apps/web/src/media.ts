import type { MediaInput } from '@manojabhiram/modelport-core';
import { AUDIO_TYPES, IMAGE_TYPES, inputMediaTypes } from '@manojabhiram/modelport-core/policy';

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export { AUDIO_TYPES, IMAGE_TYPES };
export type MediaKind = 'image' | 'audio';

export interface Upload {
  name: string;
  bytes: number;
  media: MediaInput;
}

export function detectedMediaType(bytes: Uint8Array): string | null {
  const starts = (values: number[], offset = 0) => values.every((value, index) => bytes[offset + index] === value);
  const text = (value: string, offset = 0) => starts(Array.from(value, (character) => character.charCodeAt(0)), offset);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (text('RIFF') && text('WEBP', 8)) return 'image/webp';
  if (text('RIFF') && text('WAVE', 8)) return 'audio/wav';
  if (text('OggS')) return 'audio/ogg';
  if (starts([0x1a, 0x45, 0xdf, 0xa3])) return 'audio/webm';
  if (text('fLaC')) return 'audio/flac';
  if (text('ID3') || (bytes.length >= 3 && bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)) return 'audio/mpeg';
  return null;
}

export async function readUpload(file: File, kind: MediaKind, providerId = ''): Promise<Upload> {
  if (file.size === 0) throw new Error('This file is empty. Choose an image or audio recording with content.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('This file is larger than 4 MiB. Choose a smaller file before reviewing a request.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = detectedMediaType(bytes);
  const allowedTypes = inputMediaTypes(providerId, kind === 'image' ? 'vision' : 'stt');
  if (!mimeType || !allowedTypes.includes(mimeType)) {
    throw new Error(kind === 'image' ? `Choose a ${allowedTypes.includes('image/webp') ? 'PNG, JPEG, or WebP' : 'PNG or JPEG'} image. The file signature must match a supported format.` : 'Choose an MP3, WAV, Ogg, WebM, or FLAC recording. The file signature must match a supported format.');
  }
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return { name: file.name, bytes: bytes.length, media: { mimeType, data: btoa(binary) } };
}

export function outputBlob(media: MediaInput): Blob {
  if (![...IMAGE_TYPES, ...AUDIO_TYPES].some((mimeType) => mimeType === media.mimeType)) throw new Error('The provider returned a media type this workbench cannot safely display.');
  const binary = atob(media.data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: media.mimeType });
}
