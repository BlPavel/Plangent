import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Router, type Request, type Response } from 'express';
import { typedRoutes } from './typed-route';

test('registers the method and relative path without changing parent params', async () => {
  const router = Router({ mergeParams: true });
  const routes = typedRoutes(router, '/api/projects/:projectId');
  routes.json('POST /api/projects/:projectId/tasks/:taskId/chat', (req, res) => {
    assert.equal(req.params.projectId, 'project');
    assert.equal(req.body.agent_id, 'agent');
    res.status(404).json({ error: 'Task not found' });
  });
  const layer = router.stack[0].route!;
  assert.equal(layer.path, '/tasks/:taskId/chat');
  assert.equal(layer.stack[0].method, 'post');
  const sent: unknown[] = [];
  const response = { status(code: number) { sent.push(code); return this; }, json(value: unknown) { sent.push(value); return this; } };
  layer.stack[0].handle({ params: { projectId: 'project', taskId: 'task' }, body: { agent_id: 'agent' } } as unknown as Request, response as unknown as Response, (error?: unknown) => { throw error; });
  assert.deepEqual(sent, [404, { error: 'Task not found' }]);
  assert.throws(() => routes.json('GET /api/health', () => {}), /outside/);
});

test('forwards sync throws and async rejections to Express', async () => {
  const router = Router(), routes = typedRoutes(router, '/api/projects/:projectId');
  const error = new Error('failed');
  routes.json('POST /api/projects/:projectId/tasks/:taskId/chat', () => { throw error; });
  routes.json('POST /api/projects/:projectId/tasks/:taskId/review', async () => { throw error; });
  for (const layer of router.stack) {
    await new Promise<void>(resolve => layer.route!.stack[0].handle({} as Request, {} as Response, (actual: unknown) => { assert.equal(actual, error); resolve(); }));
  }
});

test('streams only NDJSON events while preserving response binding and backpressure', () => {
  const router = Router(), routes = typedRoutes(router, '/api/projects/:projectId');
  const chunks: string[] = [];
  let ended = false;
  routes.stream('GET /api/projects/:projectId/code/search', (_req, res) => {
    assert.equal(res.status(200), res);
    assert.equal(res.event({ type: 'done', matches: 0, files: 0, truncated: false }), false);
    res.end();
  });
  const response = {
    status(code: number) { assert.equal(this, response); assert.equal(code, 200); return this; },
    write(text: string) { assert.equal(this, response); chunks.push(text); return false; },
    end() { assert.equal(this, response); ended = true; },
  };
  router.stack[0].route!.stack[0].handle({} as Request, response as unknown as Response, (error?: unknown) => { throw error; });
  assert.deepEqual(chunks, ['{"type":"done","matches":0,"files":0,"truncated":false}\n']);
  assert.equal(ended, true);
});

test('preserves file bytes and empty response status', () => {
  const router = Router(), routes = typedRoutes(router, '/api/projects/:projectId');
  const bytes = new Uint8Array([0, 255, 42]);
  routes.file('GET /api/projects/:projectId/code/image', (_req, res) => { res.send(bytes); });
  routes.empty('DELETE /api/projects/:projectId/code-reviews/:reviewId', (_req, res) => { res.status(204).end(); });
  let ended = false, status = 0;
  const response = {
    send(value: Uint8Array) { assert.equal(value, bytes); },
    status(code: number) { status = code; return this; },
    end() { ended = true; },
  } as unknown as Response;
  for (const layer of router.stack) layer.route!.stack[0].handle({} as Request, response, (error?: unknown) => { throw error; });
  assert.equal(status, 204);
  assert.equal(ended, true);
});
