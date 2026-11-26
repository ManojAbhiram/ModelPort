import type { Approval, RunResult } from '@manojabhiram/modelport-core';

// Deliberate allowlists: never serialize a connection, approval or result wholesale.
export function exportRecord(approval: Approval, result: RunResult, includeContent = false) {
  return {
    format: 'modelport-run-v1',
    contentIncluded: includeContent,
    mediaIncluded: false,
    request: {
      providerId: approval.providerId, modelId: approval.modelId, operation: approval.operation,
      capabilitySource: approval.capabilitySource, verificationState: approval.verificationState,
      inputCharacters: approval.inputCharacters, mediaBytes: approval.mediaBytes, mediaType: approval.mediaType,
      maxOutputTokens: approval.maxOutputTokens, voice: approval.voice,
      ...(includeContent && approval.operation !== 'stt' ? { text: approval.inputPreview } : {}),
    },
    result: {
      durationMs: result.durationMs,
      usage: result.usage ? { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens } : undefined,
      mediaType: result.media?.mimeType,
      ...(includeContent ? { text: result.text, embedding: result.embedding } : {}),
    },
  };
}

export function requestExample(approval: Approval, includeContent = false): string {
  const fields = {
    modelId: approval.modelId, operation: approval.operation,
    ...(approval.operation !== 'stt' ? { text: includeContent ? approval.inputPreview : 'REPLACE_WITH_YOUR_INPUT' } : {}),
    ...(approval.maxOutputTokens !== undefined ? { maxOutputTokens: approval.maxOutputTokens } : {}),
    ...(approval.voice !== undefined ? { voice: approval.voice } : {}),
  };
  const hasMedia = approval.operation === 'vision' || approval.operation === 'stt';
  return `import type { ModelPort${hasMedia ? ', MediaInput' : ''} } from '@manojabhiram/modelport-core';

// Server-side: use an existing connection to the selected provider.
// Your host authenticates the user and derives sessionScope itself.
export function prepareRequest(port: ModelPort, connectionId: string, sessionScope: string${hasMedia ? ', media: MediaInput' : ''}) {
  return port.prepare({
    connectionId,
${JSON.stringify(fields, null, 4).slice(2, -2)}${hasMedia ? ',\n    media' : ''}
  }, { scope: sessionScope });
}

// Show the returned approval to the human in your authenticated host UI.
// Execute separately only after their explicit approval; never auto-run.
// Media bytes and credentials are deliberately excluded from this example.
`;
}
