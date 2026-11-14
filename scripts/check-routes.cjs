// Compare HTTP registrations with declaration-only endpoint maps without starting services.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const parse = file => ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
const walk = (node, visit) => { visit(node); ts.forEachChild(node, child => walk(child, visit)); };
const expected = new Map(), actual = new Map(), errors = [];
for (const file of fs.readdirSync(path.join(root, 'contracts')).filter(file => file.endsWith('.d.ts'))) {
  walk(parse('contracts/' + file), node => {
    if (!ts.isPropertySignature(node) || !node.type || !ts.isTypeReferenceNode(node.type) || node.type.typeName.getText() !== 'Endpoint') return;
    const key = node.name.text;
    const kind = node.type.typeArguments[4]?.literal.text ?? 'json';
    if (expected.has(key)) errors.push('Duplicate contract: ' + key);
    expected.set(key, kind === 'ndjson' ? 'stream' : kind);
  });
}
for (const file of ['server.ts', ...fs.readdirSync(path.join(root, 'server/api/http/routes')).filter(file => file.endsWith('.ts')).map(file => 'routes/' + file)]) {
  const ast = parse('server/api/http/' + file), routers = new Set(['app']), helpers = new Set();
  walk(ast, node => {
    if (!ts.isVariableDeclaration(node) || !node.initializer || !ts.isCallExpression(node.initializer)) return;
    if (node.initializer.expression.getText() === 'Router') routers.add(node.name.getText());
    if (node.initializer.expression.getText() === 'typedRoutes') helpers.add(node.name.getText());
  });
  walk(ast, node => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    const receiver = node.expression.expression, method = node.expression.name.text;
    if (routers.has(receiver.getText()) && ['get', 'post', 'put', 'patch', 'delete', 'all', 'route'].includes(method)) errors.push('Untyped registration: ' + file + ': ' + node.getText());
    if (!helpers.has(receiver.getText()) && !(ts.isCallExpression(receiver) && receiver.expression.getText() === 'typedRoutes')) return;
    if (!['json', 'empty', 'file', 'stream'].includes(method)) return;
    const key = node.arguments[0];
    if (!ts.isStringLiteral(key)) { errors.push('Nonliteral endpoint: ' + file); return; }
    if (actual.has(key.text)) errors.push('Duplicate registration: ' + key.text);
    actual.set(key.text, method);
  });
}
for (const [key, kind] of expected) {
  if (!actual.has(key)) errors.push('Missing registration: ' + key);
  else if (actual.get(key) !== kind) errors.push('Wrong response kind: ' + key);
}
for (const key of actual.keys()) if (!expected.has(key)) errors.push('Missing contract: ' + key);
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`All ${actual.size} HTTP routes match the contract.`);
