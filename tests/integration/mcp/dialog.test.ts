/**
 * Integration tests for dialog handling, called through the MCP server
 */

import { assert, describe, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mcpTest, type McpTestServer, type ToolResult } from '../../helpers/mcp.js';
import { fixtureUrl, waitFor } from '../../helpers/firefox.js';

async function getResult(mcp: McpTestServer) {
  return (await mcp.callTool('evaluate_script', { function: '() => window.result' })).text;
}

async function runScript(mcp: McpTestServer, fn: string) {
  const result = await mcp.callTool('evaluate_script', { function: fn });
  expect(result.isError).toBe(false);
}

async function getUids(mcp: McpTestServer, ...labels: string[]) {
  const snapshot = await mcp.callTool('take_snapshot');
  return labels.map((label) => {
    const uid = new RegExp(`uid=(\\S+) ${label}`).exec(snapshot.text)?.[1];
    assert(uid, `snapshot contains the uid for ${label}`);
    return uid;
  });
}

async function expectDialogOpened(mcp: McpTestServer, result: ToolResult, dialog = 'alert "foo"') {
  expect(result.isError).toBe(false);
  expect(result.text).toContain(`Dialog opened while tool was running: ${dialog}`);

  const accepted = await mcp.callTool('accept_dialog');
  expect(accepted.isError).toBe(false);
  expect(accepted.text).toContain('Accepted');
}

describe('Dialog handlers', () => {
  describe.each([
    {
      method: 'alert',
      acceptExpectation: 'undefined',
      dismissExpectation: 'undefined',
    },
    {
      method: 'confirm',
      acceptExpectation: 'true',
      dismissExpectation: 'false',
    },
    {
      method: 'prompt',
      acceptExpectation: '"bar"',
      dismissExpectation: 'null',
    },
  ])('$method dialog', ({ method, acceptExpectation, dismissExpectation }) => {
    mcpTest.beforeEach(async ({ mcp }) => {
      await mcp.callTool('evaluate_script', {
        function: `() => { window.result = 'pending'; setTimeout(() => { window.result = ${method}('foo'); }); }`,
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(await getResult(mcp)).toContain('"pending"');
    });

    mcpTest('should be left open until it is accepted', async ({ mcp }) => {
      const result = await mcp.callTool(
        'accept_dialog',
        method === 'prompt' ? { promptText: 'bar' } : undefined
      );
      expect(result.isError).toBe(false);
      expect(result.text).toContain('Accepted');

      await waitFor(async () => !(await getResult(mcp)).includes('"pending"'));
      expect(await getResult(mcp)).toContain(acceptExpectation);
    });

    mcpTest('should be left open until it is dismissed', async ({ mcp }) => {
      const result = await mcp.callTool('dismiss_dialog');
      expect(result.isError).toBe(false);
      expect(result.text).toContain('Dismissed');

      await waitFor(async () => !(await getResult(mcp)).includes('"pending"'));
      expect(await getResult(mcp)).toContain(dismissExpectation);
    });
  });

  mcpTest('accept_dialog should fail if there is no dialog', async ({ mcp }) => {
    const result = await mcp.callTool('accept_dialog');
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Failed to accept dialog');
  });

  mcpTest('dismiss_dialog should fail if there is no dialog', async ({ mcp }) => {
    const result = await mcp.callTool('dismiss_dialog');
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Failed to dismiss dialog');
  });

  describe('tools should return when a dialog opens', () => {
    const alertPage = `data:text/html,<script>alert('foo')</script>`;

    mcpTest('evaluate_script', async ({ mcp }) => {
      const result = await mcp.callTool('evaluate_script', {
        function: `() => alert('foo')`,
      });
      await expectDialogOpened(mcp, result);
    });

    describe('on simple.html', () => {
      mcpTest.beforeEach(async ({ mcp }) => {
        await mcp.callTool('navigate_page', { url: fixtureUrl('simple.html') });
      });

      mcpTest('click_by_uid', async ({ mcp }) => {
        await runScript(
          mcp,
          `() => document.getElementById('clickBtn').addEventListener('click', () => alert('foo'), { once: true })`
        );
        const [uid] = await getUids(mcp, 'button "Click Me"');

        await expectDialogOpened(mcp, await mcp.callTool('click_by_uid', { uid }));
      });

      mcpTest('hover_by_uid', async ({ mcp }) => {
        await runScript(
          mcp,
          `() => document.getElementById('dblClickBtn').addEventListener('mouseover', () => alert('foo'), { once: true })`
        );
        const [uid] = await getUids(mcp, 'button "Double Click Me"');

        await expectDialogOpened(mcp, await mcp.callTool('hover_by_uid', { uid }));
      });

      mcpTest('drag_by_uid_to_uid', async ({ mcp }) => {
        await runScript(
          mcp,
          `() => document.getElementById('dblClickBtn').addEventListener('drop', () => alert('foo'), { once: true })`
        );
        const [fromUid, toUid] = await getUids(
          mcp,
          'button "Click Me"',
          'button "Double Click Me"'
        );

        await expectDialogOpened(mcp, await mcp.callTool('drag_by_uid_to_uid', { fromUid, toUid }));
      });

      mcpTest('press_key', async ({ mcp }) => {
        await runScript(
          mcp,
          `() => document.addEventListener('keydown', () => alert('foo'), { once: true })`
        );

        await expectDialogOpened(mcp, await mcp.callTool('press_key', { key: 'a' }));
      });

      mcpTest('type_text', async ({ mcp }) => {
        await runScript(
          mcp,
          `() => document.addEventListener('keydown', () => alert('foo'), { once: true })`
        );

        await expectDialogOpened(mcp, await mcp.callTool('type_text', { text: 'abc' }));
      });

      mcpTest('print_page', async ({ mcp }) => {
        await runScript(
          mcp,
          `() => window.addEventListener('beforeprint', () => alert('foo'), { once: true })`
        );

        await expectDialogOpened(mcp, await mcp.callTool('print_page', { saveTo: mcp.home }));
      });

      mcpTest('navigate_history', async ({ mcp }) => {
        await runScript(
          mcp,
          `() => {
            history.pushState(null, '', '#next');
            window.addEventListener('popstate', () => alert('foo'), { once: true });
          }`
        );

        await expectDialogOpened(
          mcp,
          await mcp.callTool('navigate_history', { direction: 'back' })
        );
      });
    });

    describe('on form.html', () => {
      mcpTest.beforeEach(async ({ mcp }) => {
        await mcp.callTool('navigate_page', { url: fixtureUrl('form.html') });
      });

      mcpTest('fill_by_uid', async ({ mcp }) => {
        await runScript(
          mcp,
          `() => document.getElementById('name').addEventListener('input', () => alert('foo'), { once: true })`
        );
        const [uid] = await getUids(mcp, 'input "Name:"');

        await expectDialogOpened(mcp, await mcp.callTool('fill_by_uid', { uid, value: 'bar' }));
      });

      mcpTest('fill_form_by_uid', async ({ mcp }) => {
        await runScript(
          mcp,
          `() => document.getElementById('email').addEventListener('input', () => alert('foo'), { once: true })`
        );
        const [nameUid, emailUid] = await getUids(mcp, 'input "Name:"', 'input "Email:"');

        await expectDialogOpened(
          mcp,
          await mcp.callTool('fill_form_by_uid', {
            elements: [
              { uid: nameUid, value: 'bar' },
              { uid: emailUid, value: 'bar@example.com' },
            ],
          })
        );
      });

      mcpTest('upload_file_by_uid', async ({ mcp }) => {
        await runScript(
          mcp,
          `() => document.getElementById('file').addEventListener('change', () => alert('foo'), { once: true })`
        );
        const [uid] = await getUids(mcp, 'input "File:"');
        const filePath = join(mcp.home, 'upload.txt');
        writeFileSync(filePath, 'bar');

        await expectDialogOpened(mcp, await mcp.callTool('upload_file_by_uid', { uid, filePath }));
      });
    });

    mcpTest('navigate_page', async ({ mcp }) => {
      await expectDialogOpened(mcp, await mcp.callTool('navigate_page', { url: alertPage }));
    });

    mcpTest('new_page', async ({ mcp }) => {
      await expectDialogOpened(mcp, await mcp.callTool('new_page', { url: alertPage }));
      await mcp.callTool('close_page', { pageIdx: 1 });
    });

    // skipped because of Bug 2090154: beforeunload dialogs are disabled
    mcpTest.skip('close_page', async ({ mcp }) => {
      await mcp.callTool('new_page', { url: fixtureUrl('simple.html') });
      await runScript(
        mcp,
        `() => window.addEventListener('beforeunload', (event) => event.preventDefault())`
      );

      await expectDialogOpened(
        mcp,
        await mcp.callTool('close_page', { pageIdx: 1 }),
        'beforeunload'
      );
    });
  });

  mcpTest(
    `accept_dialog without promptText should use a prompt's default value`,
    async ({ mcp }) => {
      await mcp.callTool('evaluate_script', {
        function: `() => window.result = prompt('foo', 'default value')`,
      });

      const accepted = await mcp.callTool('accept_dialog');
      expect(accepted.isError).toBe(false);
      expect(accepted.text).toBe('Accepted: "default value"');

      const result = await mcp.callTool('evaluate_script', {
        function: '() => window.result',
      });
      expect(result.isError).toBe(false);
      expect(result.text).toContain('default value');
    }
  );

  mcpTest(
    `accept_dialog should override a prompt's default value with an empty string`,
    async ({ mcp }) => {
      await mcp.callTool('evaluate_script', {
        function: `() => window.result = prompt('foo', 'default value')`,
      });

      const accepted = await mcp.callTool('accept_dialog', { promptText: '' });
      expect(accepted.isError).toBe(false);
      expect(accepted.text).toBe('Accepted: ""');

      const result = await mcp.callTool('evaluate_script', {
        function: '() => window.result',
      });
      expect(result.isError).toBe(false);
      expect(result.text).toContain('""');
    }
  );

  mcpTest(
    'accept_dialog should ignore promptText if the current dialog is not a prompt',
    async ({ mcp }) => {
      await mcp.callTool('evaluate_script', {
        function: `() => alert('foo')`,
      });

      const accepted = await mcp.callTool('accept_dialog', { promptText: 'bar' });
      expect(accepted.isError).toBe(false);
      expect(accepted.text).toBe('Accepted');
    }
  );
});
