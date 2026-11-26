import { describe, expect, it } from 'vitest';
import type { Approval, RunResult } from '@manojabhiram/modelport-core';
import { exportRecord, requestExample } from '../artifacts';

const approval = {
  providerId: 'openai', modelId: 'test-model', operation: 'text',
  inputPreview: 'private prompt', inputCharacters: 14, mediaBytes: 10,
  mediaType: 'image/png', maxOutputTokens: 512, capabilitySource: 'provider',
  verificationState: 'authenticated', destination: 'https://api.openai.com/v1',
  id: 'private-approval', connectionId: 'private-connection', apiKey: 'secret-key',
} as Approval & { apiKey: string };
const result: RunResult = { id: 'private-result', providerId: 'openai', modelId: 'test-model', operation: 'text', durationMs: 42, text: 'private answer', media: { data: 'secret-bytes', mimeType: 'image/png' }, usage: { inputTokens: 3 } };

describe('deliberate workbench artifacts', () => {
  it('omits content, credentials, internal IDs, and media bytes by default', () => {
    const exported = JSON.stringify(exportRecord(approval, result));
    for (const secret of ['private prompt', 'private answer', 'secret-key', 'secret-bytes', 'private-approval', 'private-connection', 'private-result']) expect(exported).not.toContain(secret);
    expect(JSON.parse(exported).result.durationMs).toBe(42);
    expect(JSON.parse(exported).contentIncluded).toBe(false);
  });
  it('includes text only after opt-in and still never exports raw media or extra fields', () => {
    const exported = JSON.stringify(exportRecord(approval, result, true));
    expect(exported).toContain('private prompt');
    expect(exported).toContain('private answer');
    expect(exported).not.toContain('secret-key');
    expect(exported).not.toContain('secret-bytes');
  });
  it('generates request-specific preparation code without execution or content by default', () => {
    const code = requestExample(approval);
    expect(code).toContain('test-model');
    expect(code).toContain('port.prepare');
    expect(code).not.toContain('.execute(');
    expect(code).not.toContain('private prompt');
    expect(code).not.toContain('secret-key');
    expect(requestExample(approval, true)).toContain('private prompt');
  });
  it('keeps transcription examples free of text and requires local media explicitly', () => {
    const code = requestExample({ ...approval, operation: 'stt' });
    expect(code).not.toContain('"text":');
    expect(code).toContain('media');
    expect(code).not.toContain('secret-bytes');
  });
  it('encodes untrusted model and text values as string literals and allowlists usage fields', () => {
    const modelId = 'model"; throw new Error("injected"); //';
    const text = 'line one\n`template ${expression}` "quoted"';
    const code = requestExample({ ...approval, modelId, inputPreview: text }, true);
    expect(code).toContain(JSON.stringify(modelId));
    expect(code).toContain(JSON.stringify(text));
    const usage = { inputTokens: 3, authorization: 'secret-header' };
    expect(JSON.stringify(exportRecord(approval, { ...result, usage }))).not.toContain('secret-header');
  });
});
