// E2E entry — runs inside the electron host. Asserts the extension
// activates and the commands are registered. Mirror of the unit test
// at `commands.test.ts` but inside a real VS Code instance.
const assert = require('node:assert');

exports.run = async () => {
  const vscode = require('vscode');
  const expected = [
    'aldoAi.login',
    'aldoAi.logout',
    'aldoAi.refresh',
    'aldoAi.runOnSelection',
    'aldoAi.runOnFile',
    'aldoAi.openRunInBrowser',
    'aldoAi.openTraceInline',
    'aldoAi.quickPrompt',
  ];
  const all = await vscode.commands.getCommands(true);
  for (const c of expected) {
    assert.ok(all.includes(c), `command ${c} not registered`);
  }
};
