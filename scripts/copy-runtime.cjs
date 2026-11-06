const fs = require('node:fs');
fs.mkdirSync('server/dist/server/api/mcp', { recursive: true });
fs.copyFileSync('server/api/mcp/stdio-proxy.cjs', 'server/dist/server/api/mcp/stdio-proxy.cjs');
