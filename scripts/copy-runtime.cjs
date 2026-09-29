const fs = require('node:fs');
fs.mkdirSync('server/dist/infrastructure/mcp', { recursive: true });
fs.copyFileSync('server/infrastructure/mcp/stdio-proxy.cjs', 'server/dist/infrastructure/mcp/stdio-proxy.cjs');
