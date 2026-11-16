import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { PROVIDERS } from '@modelport/core/catalog';
import type { Approval, Connection, Model, RunInput } from '@modelport/core';

const connectionId = '10000000-0000-4000-8000-000000000001';
const approvalId = '10000000-0000-4000-8000-000000000002';

function fixtureConnection(providerId: string, models: Model[], id = connectionId, name?: string): Connection {
  const provider = PROVIDERS.find((item) => item.id === providerId);
  if (!provider) throw new Error(`Unknown fixture provider: ${providerId}`);
  const now = new Date().toISOString();
  return {
    id, name: name ?? provider.name, providerId, baseUrl: provider.baseUrl, createdAt: now,
    verification: { state: 'authenticated', checkedAt: now, message: 'Authenticated metadata only; inference not tested.', inferenceTested: false },
    models,
  };
}

async function mockProviders(page: Page, initialConnections: Connection[] = []) {
  const state = { connections: initialConnections, executions: 0, preparations: [] as RunInput[], keySubmitted: '', cancellations: 0 };
  const pending = new Map<string, Approval>();
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (method !== 'GET') expect(request.headers()['x-csrf-token']).toBe('browser-test-csrf');
    if (path === '/api/session') {
      expect(request.headers()['x-modelport-client']).toBe('workbench');
      return route.fulfill({ json: { csrfToken: 'browser-test-csrf', expiresAt: new Date(Date.now() + 3_600_000).toISOString() } });
    }
    if (path === '/api/providers') return route.fulfill({ json: { providers: PROVIDERS } });
    if (path === '/api/connections' && method === 'GET') return route.fulfill({ json: { connections: state.connections } });
    if (path === '/api/connections' && method === 'POST') {
      const config = request.postDataJSON();
      state.keySubmitted = config.apiKey;
      const connection: Connection = {
        id: connectionId, name: config.name || 'OpenAI', providerId: 'openai', baseUrl: 'https://api.openai.com/v1',
        createdAt: new Date().toISOString(),
        verification: { state: 'authenticated', checkedAt: new Date().toISOString(), message: 'Authenticated metadata only; inference not tested.', inferenceTested: false },
        models: [
          { id: 'test-chat', name: 'Test chat', providerId: 'openai', operations: ['text', 'vision'], capabilitySource: 'provider' },
          { id: 'test-embedding', name: 'Test embedding', providerId: 'openai', operations: ['embedding'], capabilitySource: 'provider' },
          { id: 'unknown-model', name: 'Unknown', providerId: 'openai', operations: [], capabilitySource: 'unknown' },
        ],
      };
      state.connections = [connection];
      return route.fulfill({ json: { connection } });
    }
    if (path === '/api/approvals' && method === 'GET') return route.fulfill({ json: { approvals: [...pending.values()] } });
    if (path === '/api/approvals' && method === 'POST') {
      const input = request.postDataJSON() as RunInput;
      state.preparations.push(input);
      const connection = state.connections.find((item) => item.id === input.connectionId);
      if (!connection) throw new Error('Unknown mocked approval connection.');
      const providerName = PROVIDERS.find((item) => item.id === connection.providerId)?.name ?? connection.providerId;
      const approval: Approval = {
        id: approvalId, connectionId: connection.id, providerId: connection.providerId, providerName, modelId: input.modelId,
        operation: input.operation, destination: connection.baseUrl, capabilitySource: 'provider', verificationState: 'authenticated',
        createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 300_000).toISOString(),
        inputPreview: input.text || 'Audio upload', inputCharacters: input.text?.length || 0,
        mediaBytes: input.media ? Buffer.from(input.media.data, 'base64').length : 0,
        mediaType: input.media?.mimeType, maxOutputTokens: input.maxOutputTokens, voice: input.voice,
        billingNotice: `This request sends input to ${providerName} and may incur provider charges. Exact cost is unknown.`,
      };
      pending.set(approval.id, approval);
      return route.fulfill({ json: { approval } });
    }
    if (path === `/api/approvals/${approvalId}` && method === 'DELETE') {
      state.cancellations++;
      pending.delete(approvalId);
      return route.fulfill({ json: { ok: true } });
    }
    if (path === `/api/approvals/${approvalId}/execute` && method === 'POST') {
      expect(request.postDataJSON()).toEqual({ consent: true });
      expect(pending.has(approvalId)).toBe(true);
      pending.delete(approvalId);
      state.executions++;
      return route.fulfill({ json: { result: { id: 'test-result', operation: 'text', providerId: 'openai', modelId: 'test-chat', durationMs: 42, text: 'Approved provider response.' } } });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Unexpected mocked route.' } } });
  });
  return state;
}

async function connect(page: Page) {
  await page.getByRole('button', { name: 'Connect OpenAI', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect OpenAI' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('API key', { exact: true }).fill('sk-browser-canary-not-a-real-key');
  await dialog.getByRole('button', { name: 'Connect & inspect' }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Playground', exact: true }).click();
  await page.getByLabel('Compatible model', { exact: true }).selectOption('test-chat');
}

test('real local workbench boots without any provider credential or horizontal overflow', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Inspect. Test.');
  await expect(page.getByRole('button', { name: 'Connect OpenAI', exact: true })).toBeVisible();
  await expect(page.getByText('Local session active', { exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('provider-library.png'), fullPage: true });
  await page.screenshot({ path: testInfo.outputPath('workbench-overview.png') });
  const notices = await page.request.get('/THIRD_PARTY_NOTICES.txt');
  expect(notices.ok()).toBe(true);
  expect(await notices.text()).toContain('Cole Bemis');
});

test('filters real providers and separates roadmap entries from executable adapters', async ({ page }) => {
  await mockProviders(page);
  await page.goto('/');
  await page.getByLabel('Search providers').fill('ElevenLabs');
  await expect(page.getByRole('heading', { name: 'ElevenLabs', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect OpenAI', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.getByRole('radio', { name: /^Roadmap/ }).check();
  await expect(page.getByRole('heading', { name: 'AWS Bedrock', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect AWS Bedrock', exact: true })).toHaveCount(0);
});

test('mock walkthrough needs no key and never prepares or executes a real request', async ({ page }, testInfo) => {
  const state = await mockProviders(page);
  const writes: string[] = [];
  page.on('request', (request) => { if (request.method() !== 'GET') writes.push(request.url()); });
  await page.goto('/');
  await page.getByRole('link', { name: /Try the mock demo/ }).click();
  await expect(page.getByText('Mock demo — no provider calls.', { exact: true })).toBeVisible();
  await page.getByLabel('Sample prompt').fill('A harmless demo question');
  await page.getByRole('button', { name: 'Review mock request' }).click();
  await expect(page.getByLabel('Sample prompt')).toBeDisabled();
  await expect(page.getByLabel('Mock request text')).toHaveText('A harmless demo question');
  await page.getByRole('button', { name: 'Approve mock response' }).click();
  await expect(page.getByText('Simulated response', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '3. Inspect the example response' })).toBeFocused();
  expect(state.preparations).toHaveLength(0);
  expect(state.executions).toBe(0);
  expect(writes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('mock-demo.png'), fullPage: true });
  await page.getByRole('button', { name: 'Reset demo' }).click();
  await expect(page.getByLabel('Sample prompt')).toBeEnabled();
  await expect(page.getByText('Simulated response', { exact: true })).toHaveCount(0);
});

test('reviews the complete text and exports only deliberately selected content', async ({ page }, testInfo) => {
  const state = await mockProviders(page);
  await page.goto('/');
  await connect(page);
  const prompt = 'x'.repeat(2500) + ' REVIEW-END';
  await page.locator('#run-text').fill(prompt);
  await page.getByRole('button', { name: 'Review request', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Complete text input')).toContainText('REVIEW-END');
  await expect(dialog).toContainText('https://api.openai.com/v1');
  await page.screenshot({ path: testInfo.outputPath('request-review.png'), fullPage: true });
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Approve & run' }).click();
  await page.getByText('Use this request in your project', { exact: true }).click();
  const artifacts = page.locator('.run-artifacts');
  await expect(artifacts.locator('pre')).not.toContainText('REVIEW-END');
  const downloadPromise = page.waitForEvent('download');
  await artifacts.getByRole('button', { name: 'Download run record' }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const record = JSON.parse(Buffer.concat(chunks).toString());
  expect(record.contentIncluded).toBe(false);
  expect(record.request.text).toBeUndefined();
  expect(record.result.text).toBeUndefined();
  expect(JSON.stringify(record)).not.toContain('sk-browser');
  await artifacts.getByRole('checkbox').check();
  await expect(artifacts.locator('pre')).toContainText('REVIEW-END');
  expect(state.executions).toBe(1);
  await page.locator('#run-text').fill('new request');
  await expect(page.locator('.run-artifacts')).toHaveCount(0);
});

test('connection dialog supports Escape and restores keyboard focus', async ({ page }) => {
  await mockProviders(page);
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Connect OpenAI', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Connect OpenAI' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Connection name optional')).toBeFocused();
  await expect(dialog.getByLabel('Local base URL')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test('skip link preserves the selected workspace page', async ({ page }) => {
  await mockProviders(page);
  await page.goto('/#guide');
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toBeVisible();
  const title = await heading.textContent();
  const skip = page.getByRole('link', { name: 'Skip to content', exact: true });
  await skip.focus();
  await skip.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await expect(page).toHaveURL(/#guide$/);
  await expect(heading).toHaveText(title!);
});

test('requires explicit consent, sends the reviewed request once, and never stores the key', async ({ page }) => {
  const state = await mockProviders(page);
  await page.goto('/');
  await connect(page);
  await page.locator('#run-text').fill('Explain safe model switching.');
  await page.getByRole('button', { name: 'Review request', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review this request', exact: true });
  await expect(dialog).toBeVisible();
  expect(state.executions).toBe(0);
  expect(state.preparations).toHaveLength(1);
  expect(state.keySubmitted).toBe('sk-browser-canary-not-a-real-key');
  await expect(dialog.getByRole('button', { name: 'Approve & run' })).toBeDisabled();
  await expect(dialog).toContainText('Exact cost is unknown');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Approve & run' }).click();
  await expect(page.getByText('Approved provider response.', { exact: true })).toBeVisible();
  expect(state.executions).toBe(1);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.content()).not.toContain('sk-browser-canary-not-a-real-key');
});

test('canceling review and changing operation never calls inference', async ({ page }) => {
  const state = await mockProviders(page);
  await page.goto('/');
  await connect(page);
  await page.locator('#run-text').fill('Do not execute this.');
  await page.getByRole('button', { name: 'Review request', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel review', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review request', exact: true })).toBeFocused();
  expect(state.cancellations).toBe(1);
  expect(state.executions).toBe(0);
  await page.getByLabel('Operation', { exact: true }).selectOption('embedding');
  await expect(page.getByLabel('Compatible model').locator('option[value="test-chat"]')).toHaveCount(0);
  await expect(page.getByLabel('Compatible model').locator('option[value="unknown-model"]')).toHaveCount(0);
  await expect(page.getByLabel('Compatible model').locator('option[value="test-embedding"]')).toHaveCount(1);
  expect(state.preparations).toHaveLength(1);
  expect(state.executions).toBe(0);
});

test('reviews inline image bytes without uploading anything to a provider', async ({ page }) => {
  const state = await mockProviders(page);
  await page.goto('/');
  await connect(page);
  await page.getByLabel('Operation', { exact: true }).selectOption('vision');
  await page.getByLabel('Compatible model').selectOption('test-chat');
  await page.locator('#run-text').fill('Describe this pixel.');
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/i9sAAAAASUVORK5CYII=', 'base64');
  await page.locator('input[type="file"]').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: bytes });
  await expect(page.getByText('pixel.png', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Review request', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review this request', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('image/png');
  expect(state.preparations[0]?.media?.data).toBe(bytes.toString('base64'));
  expect(state.executions).toBe(0);
  await dialog.getByRole('button', { name: 'Cancel review', exact: true }).click();
});

test('lazily mounts closed catalogs and paginates a full searchable model catalog', async ({ page }) => {
  const connections = Array.from({ length: 16 }, (_, index) => {
    const name = `Catalog ${index + 1}`;
    const id = `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    const models = Array.from({ length: 1000 }, (_, modelIndex): Model => {
      const modelId = `catalog-${index + 1}-model-${String(modelIndex).padStart(4, '0')}`;
      return { id: modelId, name: modelId, providerId: 'openai', operations: ['text'], capabilitySource: 'provider' };
    });
    return fixtureConnection('openai', models, id, name);
  });
  await mockProviders(page, connections);
  await page.goto('/#connections');
  await expect(page.locator('.connection-card')).toHaveCount(16);
  await expect(page.locator('.catalog-disclosure[open]')).toHaveCount(0);
  await expect(page.locator('.model-catalog')).toHaveCount(0);
  await expect(page.locator('.model-table tbody tr')).toHaveCount(0);

  const card = page.locator('.connection-card').first();
  const summary = card.locator('.catalog-disclosure > summary');
  const rows = card.locator('.model-table tbody tr');
  const status = card.locator('.catalog-pagination').getByRole('status');
  const previous = card.getByRole('button', { name: 'Previous', exact: true });
  const next = card.getByRole('button', { name: 'Next', exact: true });
  await summary.focus();
  await summary.press('Enter');
  await expect(page.locator('.model-catalog')).toHaveCount(1);
  await expect(rows).toHaveCount(50);
  await expect(status).toHaveText('1,000 matching models. Page 1 of 20.');
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();

  await next.click();
  await expect(rows).toHaveCount(50);
  await expect(rows.first()).toContainText('catalog-1-model-0050');
  await expect(card.getByText('catalog-1-model-0000', { exact: true })).toHaveCount(0);
  await expect(status).toHaveText('1,000 matching models. Page 2 of 20.');
  await expect(previous).toBeEnabled();
  await card.getByRole('button', { name: 'Declare capabilities for catalog-1-model-0050', exact: true }).click();
  const declaration = page.getByRole('dialog', { name: 'Declare model capabilities', exact: true });
  await expect(declaration.getByLabel('Exact model ID', { exact: true })).toHaveValue('catalog-1-model-0050');
  await declaration.getByRole('button', { name: 'Cancel', exact: true }).click();
  await previous.click();
  await expect(status).toHaveText('1,000 matching models. Page 1 of 20.');
  await next.click();

  const search = card.getByLabel('Search models in Catalog 1', { exact: true });
  await search.fill('CATALOG-1-MODEL-0999');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('catalog-1-model-0999');
  await expect(status).toHaveText('1 matching model. Page 1 of 1.');
  await expect(previous).toBeDisabled();
  await expect(next).toBeDisabled();
  await search.fill('no-matching-model');
  await expect(rows).toHaveCount(0);
  await expect(status).toHaveText('0 matching models. Page 1 of 1.');
  await expect(previous).toBeDisabled();
  await expect(next).toBeDisabled();

  const secondSummary = page.locator('.connection-card').nth(1).locator('.catalog-disclosure > summary');
  await secondSummary.click();
  await expect(page.locator('.model-table tbody tr')).toHaveCount(50);
  await summary.press('Space');
  await expect(card.locator('.model-catalog')).toHaveCount(0);
  await expect(page.locator('.model-catalog')).toHaveCount(1);
  await summary.press('Enter');
  await expect(rows).toHaveCount(50);
  await expect(search).toHaveValue('');
  await expect(status).toHaveText('1,000 matching models. Page 1 of 20.');
  await expect(page.locator('.model-table tbody tr')).toHaveCount(100);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await summary.press('Space');
  await secondSummary.press('Enter');
  await expect(page.locator('.model-catalog')).toHaveCount(0);
  await expect(page.locator('.model-table tbody tr')).toHaveCount(0);
});

test('defaults a sole catalog open, clamps pages after refresh, and preserves a closed toggle', async ({ page }) => {
  const models = Array.from({ length: 101 }, (_, index): Model => ({
    id: `model-${index}`, name: `model-${index}`, providerId: 'openai', operations: ['text'], capabilitySource: 'provider',
  }));
  const state = await mockProviders(page, [fixtureConnection('openai', models, connectionId, 'Changing catalog')]);
  await page.route(`**/api/connections/${connectionId}/refresh`, async (route) => {
    expect(route.request().headers()['x-csrf-token']).toBe('browser-test-csrf');
    return route.fulfill({ json: { connection: state.connections[0] } });
  });
  await page.goto('/#connections');
  const card = page.locator('.connection-card');
  const rows = card.locator('.model-table tbody tr');
  const status = card.locator('.catalog-pagination').getByRole('status');
  const next = card.getByRole('button', { name: 'Next', exact: true });
  const refresh = card.getByRole('button', { name: 'Refresh metadata for Changing catalog', exact: true });
  await expect(card.locator('.catalog-disclosure')).toHaveAttribute('open', '');
  await expect(rows).toHaveCount(50);
  await next.click();
  await next.click();
  await expect(status).toHaveText('101 matching models. Page 3 of 3.');
  await expect(rows).toHaveCount(1);

  state.connections = [fixtureConnection('openai', models.slice(0, 60), connectionId, 'Changing catalog')];
  await refresh.click();
  await expect(status).toHaveText('60 matching models. Page 2 of 2.');
  await expect(rows).toHaveCount(10);
  await expect(next).toBeDisabled();
  await expect(card.getByRole('button', { name: 'Previous', exact: true })).toBeEnabled();
  state.connections = [fixtureConnection('openai', models, connectionId, 'Changing catalog')];
  await refresh.click();
  await expect(status).toHaveText('101 matching models. Page 2 of 3.');
  await expect(rows).toHaveCount(50);

  await card.locator('.catalog-disclosure > summary').press('Enter');
  await expect(card.locator('.model-catalog')).toHaveCount(0);
  state.connections = [fixtureConnection('openai', models.slice(0, 60), connectionId, 'Changing catalog')];
  await refresh.click();
  await expect(card.locator('.catalog-count')).toHaveText('60 models');
  await expect(card.locator('.catalog-disclosure[open]')).toHaveCount(0);
  await expect(card.locator('.model-table tbody tr')).toHaveCount(0);
});

test('rejects Cerebras WebP before preparing review while PNG still prepares', async ({ page }) => {
  const model: Model = { id: 'qwen-3.8-27b', name: 'qwen-3.8-27b', providerId: 'cerebras', operations: ['text', 'vision'], capabilitySource: 'provider' };
  const state = await mockProviders(page, [fixtureConnection('cerebras', [model])]);
  await page.goto('/#playground');
  await page.getByLabel('Operation', { exact: true }).selectOption('vision');
  await page.getByLabel('Compatible model', { exact: true }).selectOption(model.id);
  await page.locator('#run-text').fill('Describe this pixel.');
  const fileInput = page.locator('input[type="file"]');
  await expect(fileInput).toHaveAttribute('accept', 'image/png,image/jpeg');
  await expect(page.locator('#upload-help')).toContainText('Still PNG, JPEG;');
  await expect(page.locator('#upload-help')).not.toContainText('WebP');
  const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
  await fileInput.setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: webp });
  await expect(page.getByText('Choose a PNG or JPEG image. The file signature must match a supported format.', { exact: true })).toBeVisible();
  await expect(page.locator('.uploaded-file')).toHaveCount(0);
  expect(state.preparations).toHaveLength(0);
  expect(state.executions).toBe(0);
  await page.getByRole('button', { name: 'Review request', exact: true }).click();
  await expect(page.getByText('Choose a supported file before reviewing this request.', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.preparations).toHaveLength(0);
  expect(state.executions).toBe(0);

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/i9sAAAAASUVORK5CYII=', 'base64');
  await fileInput.setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByText('pixel.png', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Review request', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review this request', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Cerebras');
  await expect(dialog).toContainText('image/png');
  expect(state.preparations).toHaveLength(1);
  expect(state.preparations[0]?.media?.data).toBe(png.toString('base64'));
  expect(state.executions).toBe(0);
  await dialog.getByRole('button', { name: 'Cancel review', exact: true }).click();
});

test('does not offer blocked routing profiles or compound agents as compatible models', async ({ page }) => {
  const fixtures = [
    { providerId: 'openrouter', ids: ['openrouter/auto', 'openrouter/auto-beta', 'openrouter/auto-code', 'openrouter/auto:free', 'vendor/model:online', 'vendor/fixed-chat', 'openrouter/autocoder'], selectable: ['vendor/fixed-chat', 'openrouter/autocoder'] },
    { providerId: 'groq', ids: ['groq/compound', 'groq/compound-mini', 'llama-3.3-70b-versatile', 'groq/compounder'], selectable: ['llama-3.3-70b-versatile', 'groq/compounder'] },
    { providerId: 'openai', ids: ['openrouter/auto-beta', 'groq/compound', 'gpt-5-mini'], selectable: ['openrouter/auto-beta', 'groq/compound', 'gpt-5-mini'] },
  ];
  const connections = fixtures.map((fixture, index) => fixtureConnection(fixture.providerId,
    fixture.ids.map((id): Model => ({ id, name: id, providerId: fixture.providerId, operations: ['text'], capabilitySource: 'provider' })),
    `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`));
  const state = await mockProviders(page, connections);
  await page.goto('/#playground');
  for (const [index, fixture] of fixtures.entries()) {
    await page.getByLabel('Connection', { exact: true }).selectOption(connections[index]!.id);
    await expect(page.getByLabel('Compatible model', { exact: true }).locator('option')).toHaveText(['Choose a model', ...fixture.selectable]);
  }
  expect(state.preparations).toHaveLength(0);
  expect(state.executions).toBe(0);
});
