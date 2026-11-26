import type { CapabilitySource, Operation, Verification } from '@manojabhiram/modelport-core';
import { AudioLines, Image, ScanEye, Speech, TextCursorInput, Braces } from 'lucide-react';

export const OPERATIONS: Operation[] = ['text', 'vision', 'image', 'stt', 'tts', 'embedding'];

export const OPERATION = {
  text: { label: 'Text generation', short: 'Text', icon: TextCursorInput, prompt: 'Prompt', placeholder: 'What would you like the model to help with?' },
  vision: { label: 'Image understanding', short: 'Vision', icon: ScanEye, prompt: 'Question about the image', placeholder: 'What should the model look for in this image?' },
  image: { label: 'Image generation', short: 'Image', icon: Image, prompt: 'Image description', placeholder: 'Describe the image you want to create.' },
  stt: { label: 'Speech to text', short: 'Transcription', icon: AudioLines, prompt: 'Transcription hint (optional)', placeholder: 'Optional context, names, or terminology in the recording.' },
  tts: { label: 'Text to speech', short: 'Speech', icon: Speech, prompt: 'Text to speak', placeholder: 'Enter the words you want to hear.' },
  embedding: { label: 'Embeddings', short: 'Embedding', icon: Braces, prompt: 'Text to embed', placeholder: 'Enter the text to represent as an embedding vector.' },
} satisfies Record<Operation, { label: string; short: string; icon: typeof Braces; prompt: string; placeholder: string }>;

export const CAPABILITY: Record<CapabilitySource, { label: string; description: string }> = {
  provider: { label: 'Provider metadata', description: 'Capabilities reported by the provider. This does not prove model access or successful inference.' },
  reference: { label: 'Reference mapping', description: 'Capabilities derived from a maintained reference, not a live inference test.' },
  declared: { label: 'Human-declared', description: 'Capabilities explicitly declared by a person. Model access and behavior remain unverified.' },
  unknown: { label: 'Unknown', description: 'Capabilities could not be established. Declare a supported operation deliberately before running.' },
};

export const VERIFICATION: Record<Verification['state'], string> = {
  authenticated: 'Credentials authenticated',
  reachable: 'Endpoint reachable',
  unverified: 'Not verified',
};

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 bytes';
  if (bytes < 1024) return `${bytes.toLocaleString()} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown time' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
