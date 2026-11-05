import { describe, expect, it, vi } from 'vitest';
import { defineToolHandler } from '../../../src/tools/module.js';
import type { McpToolResponse } from '../../../src/types/common.js';

describe('defineToolHandler', () => {
  it('passes successful responses through unchanged', async () => {
    const response: McpToolResponse = {
      content: [{ type: 'text', text: 'ok' }],
    };
    const handler = defineToolHandler(async () => response, false);

    await expect(handler()).resolves.toBe(response);
  });

  it('converts thrown errors to MCP error responses', async () => {
    const handler = defineToolHandler(() => {
      throw new Error('boom');
    }, false);

    await expect(handler()).resolves.toEqual({
      content: [{ type: 'text', text: 'Error: boom' }],
      isError: true,
    });
  });

  it('normalizes non-Error rejections', async () => {
    const rejectedHandler = vi.fn<() => Promise<McpToolResponse>>().mockRejectedValue('rejected');
    const handler = defineToolHandler(rejectedHandler, false);

    await expect(handler()).resolves.toEqual({
      content: [{ type: 'text', text: 'Error: rejected' }],
      isError: true,
    });
  });
});
