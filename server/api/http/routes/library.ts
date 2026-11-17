import { typedRoutes } from '../typed-route';
import { DEFAULT_INTERVIEW_INSTRUCTION } from '../../../core/library/interview-instruction';
import { Router } from 'express';
import {
  listLibraryItems, getLibraryItem,
  libraryItemsFor,
} from '../../../core/library';
import { getProject } from '../../../core/projects';
import { readItemContent, readOverrideContent } from '../../../core/library/library-manager';
import { DEFAULT_CODE_FIXER_INSTRUCTION } from '../../../core/library/code-fixer-instruction';
import { DEFAULT_COMMIT_RULES } from '../../../core/library/commit-rules';
import { DEFAULT_MR_RULES } from '../../../core/library/mr-rules';
import { DEFAULT_PLAN_REVIEW_INSTRUCTION } from '../../../core/library/plan-review-instruction';
import { DEFAULT_MR_REVIEW_INSTRUCTION } from '../../../core/library/mr-review-instruction';
import { instructionTextState } from '../../../core/library/instruction-texts';
import { saveLibraryItem, removeLibraryItem, detachLibraryItem, excludeLibraryItem, saveLibraryOverride, removeLibraryOverride, LibraryOperationError } from '../../../core/library/operations';
import { DEFAULT_INSTRUCTION_GUIDE } from '../../../core/library/instruction-guide';
import { MATERIAL_KINDS } from '../../../core/preparation/materials/kinds';
import { PLAN_PROTOCOL_LOCKED } from '../../../core/library/plan-template';
import { syncAll } from '../../../core/library/syncer';
import { LibraryItemType, LibraryScope } from '../../../models';

import { listProposals, applyProposal, rejectProposal, ProposalConflict } from '../../../core/library/proposals';

export const libraryRouter = Router();
const libraryRouterRoutes = typedRoutes(libraryRouter, '/api/library');

libraryRouterRoutes.json('GET /api/library/proposals', (req, res) => {
  res.json(listProposals({
    projectId: typeof req.query.projectId === 'string' ? req.query.projectId : undefined,
    sessionId: typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined,
  }));
});
libraryRouterRoutes.json('POST /api/library/proposals/:proposalId/apply', (req, res) => {
  try {
    const item = applyProposal(req.params.proposalId, req.body.availability);
    res.json(item);
  } catch (e) {
    res.status(e instanceof ProposalConflict ? 409 : 400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
libraryRouterRoutes.json('POST /api/library/proposals/:proposalId/reject', (req, res) => {
  try { res.json(rejectProposal(req.params.proposalId)); }
  catch (e) { res.status(e instanceof ProposalConflict ? 409 : 400).json({ error: e instanceof Error ? e.message : String(e) }); }
});



libraryRouterRoutes.json('GET /api/library/interview-instruction/defaults', (_req, res) => res.json({ content: DEFAULT_INTERVIEW_INSTRUCTION }));


libraryRouterRoutes.json('GET /api/library/code-fixer-instruction/defaults', (_req, res) => {
  res.json({ content: DEFAULT_CODE_FIXER_INSTRUCTION });
});

libraryRouterRoutes.json('GET /api/library/commit-rules/defaults', (_req, res) => {
  res.json({ content: DEFAULT_COMMIT_RULES });
});

libraryRouterRoutes.json('GET /api/library/mr-rules/defaults', (_req, res) => {
  res.json({ content: DEFAULT_MR_RULES });
});

libraryRouterRoutes.json('GET /api/library/mr-review-instruction/defaults', (_req, res) => {
  res.json({ content: DEFAULT_MR_REVIEW_INSTRUCTION });
});

libraryRouterRoutes.json('GET /api/library/plan-review-instruction/defaults', (_req, res) => {
  res.json({ content: DEFAULT_PLAN_REVIEW_INSTRUCTION });
});

libraryRouterRoutes.json('GET /api/library/architecture-review-instruction/defaults', (_req, res) => { res.json({ content: MATERIAL_KINDS.architecture.defaultReviewInstruction }); });
libraryRouterRoutes.json('GET /api/library/architecture-template/defaults', (_req, res) => { res.json({ content: MATERIAL_KINDS.architecture.defaultTemplate, lockedProtocol: MATERIAL_KINDS.architecture.protocol }); });
libraryRouterRoutes.json('GET /api/library/qa-review-instruction/defaults', (_req, res) => { res.json({ content: MATERIAL_KINDS.qa.defaultReviewInstruction }); });
libraryRouterRoutes.json('GET /api/library/qa-template/defaults', (_req, res) => { res.json({ content: MATERIAL_KINDS.qa.defaultTemplate, lockedProtocol: MATERIAL_KINDS.qa.protocol }); });

libraryRouterRoutes.json('GET /api/library/instruction-guide/defaults', (_req, res) => {
  res.json({ content: DEFAULT_INSTRUCTION_GUIDE });
});

libraryRouterRoutes.json('GET /api/library/plan-template/defaults', (_req, res) => {
  res.json({
    lockedProtocol: PLAN_PROTOCOL_LOCKED,
  });
});

libraryRouterRoutes.json('GET /api/library', (req, res) => {
  const { type, scope, projectId, forProject } = req.query;
  // Everything that applies to a project or group, with its origin (global / group / direct).
  if (typeof forProject === 'string') {
    const project = getProject(forProject);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    return res.json(libraryItemsFor(project, type as LibraryItemType | undefined));
  }
  const items = listLibraryItems({
    type: type as LibraryItemType | undefined,
    scope: scope as LibraryScope | undefined,
    projectId: projectId as string | undefined,
  });
  res.json(items);
});

libraryRouterRoutes.json('GET /api/library/instruction-text', (req, res) => {
  try { res.json(instructionTextState(req.query.type, req.query.scope, req.query.projectId)); }
  catch (error) { operationError(res, error); }
});

libraryRouterRoutes.json('GET /api/library/:id', (req, res) => {
  const item = getLibraryItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const content = readItemContent(item);
  res.json({ ...item, content });
});

function operationError(res: { status(code: number): { json(body: { error: string }): unknown } }, error: unknown) {
  return res.status(error instanceof LibraryOperationError ? error.status : 400).json({ error: error instanceof Error ? error.message : String(error) });
}

libraryRouterRoutes.json('POST /api/library', (req, res) => {
  try {
    const body = req.body;
    res.status(201).json(saveLibraryItem({ ...body, targets: body.targets ?? (body.project_id ? [body.project_id] : []) }));
  } catch (error) { operationError(res, error); }
});
libraryRouterRoutes.json('PUT /api/library/:id', (req, res) => {
  try { res.json(saveLibraryItem(req.body, { id: req.params.id })); }
  catch (error) { operationError(res, error); }
});
libraryRouterRoutes.json('POST /api/library/:id/detach', (req, res) => {
  try { res.status(201).json(detachLibraryItem(req.params.id, req.body.projectId, req.body.changes)); }
  catch (error) { operationError(res, error); }
});
libraryRouterRoutes.json('POST /api/library/:id/exclude', (req, res) => {
  try { excludeLibraryItem(req.params.id, req.body.projectId); res.json({ ok: true }); }
  catch (error) { operationError(res, error); }
});
libraryRouterRoutes.json('DELETE /api/library/:id', (req, res) => {
  try { removeLibraryItem(req.params.id); res.json({ ok: true }); }
  catch (error) { operationError(res, error); }
});

// Override content for specific agent type
libraryRouterRoutes.json('GET /api/library/:id/overrides/:agentType', (req, res) => {
  const item = getLibraryItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const content = readOverrideContent(item, req.params.agentType);
  res.json({ content: content ?? null });
});

libraryRouterRoutes.json('PUT /api/library/:id/overrides/:agentType', (req, res) => {
  try { saveLibraryOverride(req.params.id, req.params.agentType, req.body.content); res.json({ ok: true }); }
  catch (error) { operationError(res, error); }
});
libraryRouterRoutes.json('DELETE /api/library/:id/overrides/:agentType', (req, res) => {
  try { removeLibraryOverride(req.params.id, req.params.agentType); res.json({ ok: true }); }
  catch (error) { operationError(res, error); }
});

// Manual full re-sync
libraryRouterRoutes.json('POST /api/library/sync', (_req, res) => {
  try {
    syncAll();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
