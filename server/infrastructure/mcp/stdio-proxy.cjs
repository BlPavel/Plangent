// Small stdio bridge for ACP adapters without HTTP MCP support. No credentials in argv.
const readline = require('node:readline');
readline.createInterface({ input: process.stdin }).on('line', async line => {
  let request;
  try {
    request = JSON.parse(line);
    const response = await fetch(process.env.PLANGENT_MCP_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${process.env.PLANGENT_MCP_TOKEN}` }, body: line,
    });
    if (request.id === undefined) return;
    if (!response.ok) throw new Error(`MCP HTTP ${response.status}`);
    process.stdout.write(JSON.stringify(await response.json()) + '\n');
  } catch (error) {
    if (request?.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: String(error) } }) + '\n');
  }
});
