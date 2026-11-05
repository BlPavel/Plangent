import { Router } from 'express';
import { typedRoutes } from './typed-route';
import type { WorkCheck } from '@contracts';

// Compile-only regression checks. This function is never executed.
function checkContractTypes() {
  const routes = typedRoutes(Router(), '/api/projects/:projectId');
  routes.json('POST /api/projects/:projectId/tasks/:taskId/chat', (req, res) => {
    const project: string = req.params.projectId;
    const agent: string | undefined = req.body.agent_id;
    void project; void agent;
    // @ts-expect-error Request fields must be present in the contract.
    req.body.arbitrary;
    // @ts-expect-error The body cannot silently change type.
    req.body.agent_id = 42;
    // @ts-expect-error Missing session fields and wrong id type.
    res.json({ id: 42 });
    // @ts-expect-error status() must retain the contract response type.
    res.status(201).json({ id: 42 });
    // @ts-expect-error send() cannot bypass JSON response checking.
    res.send({ arbitrary: true });
    res.status(404).json({ error: 'Task not found' });
  });
  // @ts-expect-error Unknown endpoints cannot be registered.
  routes.json('GET /api/not-in-contract', () => {});
  // @ts-expect-error Files must use the file variant.
  routes.json('GET /api/projects/:projectId/code/image', () => {});
  routes.stream('GET /api/projects/:projectId/code/search', (_req, res) => {
    res.event({ type: 'done', matches: 0, files: 0, truncated: false });
    // @ts-expect-error Stream events are checked against the endpoint's event type.
    res.event({ type: 'done', matches: 'wrong' });
  });
  const check = {} as WorkCheck;
  routes.json('GET /api/projects/:projectId/tasks/:taskId/check', (_req, res) => {
    res.json(check);
    // @ts-expect-error Work check changes use file/diff, not GitChange.path.
    res.json({ ...check, changes: [{ path: 'file.ts', diff: '' }] });
  });
  routes.file('GET /api/projects/:projectId/code/image', (_req, res) => {
    res.send(new Uint8Array([1]));
    // @ts-expect-error A file response cannot send an untyped JSON object.
    res.send({ arbitrary: true });
  });
  routes.empty('DELETE /api/terminals/:id', (_req, res) => {
    res.status(204).end();
    // @ts-expect-error Empty endpoints can only send JSON errors.
    res.json({ ok: true });
  });
}
void checkContractTypes;
