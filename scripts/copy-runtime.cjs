const fs = require('node:fs');
fs.mkdirSync('server/dist/api/mcp', { recursive: true });
fs.copyFileSync('server/api/mcp/stdio-proxy.cjs', 'server/dist/api/mcp/stdio-proxy.cjs');
