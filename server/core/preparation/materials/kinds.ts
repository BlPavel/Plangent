import type { MaterialType } from './index';
import type { LibraryItemType } from '../../../models';

/** Texts and library types of a preparation section; kept free of imports from the library to avoid cycles. */
export interface MaterialKind {
  templateType: LibraryItemType; reviewInstructionType: LibraryItemType; reviewSkillType: LibraryItemType;
  idPrefix: 'D' | 'Q'; title: string; defaultTemplate: string; protocol: string;
  defaultReviewInstruction: string; reviewSkillAuthoring: string;
}

const COMMON_PROTOCOL = (id: 'D' | 'Q', noun: string) => `## Plangent agent instructions

These are instructions for the agent, not document content. Follow them, but never copy this block into the document or include it in a submission. If an existing draft contains this service block, remove the block while preserving the developer's document text.

The document is free-form Markdown. Read it with get_material and save its complete text only with submit_material, passing the version from get_material. If a developer edit causes a version conflict, read it again and reapply your changes without overwriting theirs.

- The developer's text and request take precedence over the template. The template is a suggestion for an empty document; do not restructure an existing draft to fit it. Sections can be combined, omitted, or changed.
- If asked only to format text, preserve its meaning, decisions, and wording.
- Mention contradictions and gaps in chat; do not silently fix them.
- A ${noun} may have a stable identifier: bold \`**${id}1**\` at the start of a line or heading, then \`**${id}2**\`, and so on. Never renumber or reuse existing identifiers; plan steps and review remarks refer to them.
- Link analysis materials using [[section]] or [[section/file]]; the section and file must exist.
- Only the developer marks a section ready. Do not mark it ready or treat stopping work as readiness.
- Write preparation documents in Russian.`;

export const ARCHITECTURE_TEMPLATE = `# Architecture

Architecture is a technical document for developers: how the system is divided into parts, what each part is responsible for, how the parts depend on each other and through which contracts they interact, and the decisions with their rationale. It does not retell requirements; the requirements are in the analysis, and this document shows how they map onto the system.

Level of detail: parts of the system (applications, libraries, modules, layers, services, screens) and the contracts between them. Not the inside of a part: library calls and operators, framework annotations and settings, private helpers, file layout inside a module, tests, order of work. Those belong to the plan. A reader should understand the structure of the solution without reading the code.

A flexible outline for an empty document. Combine, omit, or change sections; completeness does not determine readiness. Write the document in Russian.

## Context and boundaries
What: the goal in one or two sentences with links to analysis, what changes and what deliberately does not, applicable project rules.
Not: a retelling of the requirements.

## Current structure
What: how the parts this task touches are organized today, briefly: which parts exist, what each is responsible for, how they depend on each other. A structural diagram when there are more than two or three parts.
Not: parts the task does not touch, a list of every class or file.

## Target structure
What: the parts after the change, each marked existing, changed, or new; the responsibility of each in one or two sentences; where each new part lives; the direction of dependencies and what each part must not know about. A structural diagram of the parts and their dependencies, with existing and new parts told apart.
Not: the internals of a part, fields of every model.

## Contracts
What: how the parts interact: requests or endpoints, public interface of a module or library, events, stored data, as a list or table: name, input, result, errors. Field-level shapes only where they are the contract itself.
Not: how a contract is implemented, private methods.

## Main flows
What: only flows that are not obvious from the structure: the order of calls between parts, who owns state, behaviour on errors and concurrent actions. A sequence diagram when the order matters.
Not: every scenario, steps inside one part.

## Decisions and constraints
What: choices that have real alternatives.
**D1** Decision, rationale, and consequences.
Not: obvious choices, conventions the project already follows.

## Exceptions and open questions
What: deliberate exceptions to project rules and unresolved questions the developer has to answer.

Diagrams: each diagram answers one question (structure, dependencies, or a flow), shows parts rather than classes, and uses the same names as the text. Prefer one structural diagram to a flow of a single screen.`;

export const QA_TEMPLATE = `# QA

A flexible outline for an empty document. Combine, omit, or change sections; completeness does not determine readiness. Write the document in Russian.

QA records what must be true at the level of code and tests and resolves ambiguities of the analysis before the plan.

Look in the analysis for ambiguities and constraints it does not state explicitly: boundary values, empty and invalid input, concurrency, access rights, behavior on failure. Record what you find as a proposed clarification or a question, not as an accepted requirement.

A criterion turns a requirement into behavior verifiable by code and tests: condition, action, expected result, boundary, and basis (a link to analysis). When the way to verify it is not obvious, state it on a separate line under the criterion.

**Q1** Condition -> action -> expected result. Basis: [[section]].

Distinguish explicit requirements, proposed clarifications, and open questions. Do not invent behavior absent from the materials; raise ambiguity as a question. Code structure rules belong in architecture, not QA.`;

const ARCHITECTURE_REVIEW = `# Architecture review
1. Check that the document follows the analysis materials and the current code. QA and the plan are not grounds for this review: they depend on the architecture.
2. Check the project's architectural rules: name the exact rule and the dependency that violates it. Explicit exceptions are allowed.
3. Check responsibility and data ownership of the affected components, error handling and concurrent operations where they matter.
4. Check that the document is technical: decisions are justified rather than requirements retold. Text and diagrams agree, component names are uniform, and existing parts are told apart from proposed ones.
5. Look for needless complication and for details that free interpretation would change.
Back every remark with a place of the document (decision id or quote), the code or the requirement, and the consequence. Keep violations apart from matters of taste.`;

const QA_REVIEW = `# QA review
1. Check that every criterion rests on the analysis materials and that no behaviour is invented. Find requirements without a criterion and criteria without a basis.
2. Check that ambiguities are raised as questions and are not decided silently; a strengthening of a requirement needs a decision.
3. Check that criteria agree with each other and with the ready architecture.
4. Check that boundaries, errors and expected results are exact and observable by code and tests.
5. Find implicit constraints the analysis implies but no criterion covers: boundary, empty and invalid input, failures.
Back every remark with a place of the document (criterion id or quote) and the source it conflicts with. Keep violations apart from suggestions.`;

export const MATERIAL_KINDS: Record<MaterialType, MaterialKind> = {
  architecture: {
    templateType: 'architecture-template', reviewInstructionType: 'architecture-review-instruction',
    reviewSkillType: 'architecture-review-skill', idPrefix: 'D', title: 'Архитектура', defaultTemplate: ARCHITECTURE_TEMPLATE,
    protocol: COMMON_PROTOCOL('D', 'decision') + "\n\n- Write diagrams as Mermaid in a ```mermaid code block. Show only what is described; do not invent components or relationships.", defaultReviewInstruction: ARCHITECTURE_REVIEW,
    reviewSkillAuthoring: 'An architecture-review-skill (type "architecture-review-skill") is the developer\'s rules for reviewing the architecture of a task in this project or group: module boundaries, allowed dependencies, ownership conventions. The general checks are given by the global review instruction, so do not repeat them. It is never synced to agent folders; the description is a one-line summary shown in the picker. Do not put an output format in the skill.',
  },
  qa: {
    templateType: 'qa-template', reviewInstructionType: 'qa-review-instruction', reviewSkillType: 'qa-review-skill',
    idPrefix: 'Q', title: 'QA', defaultTemplate: QA_TEMPLATE, protocol: COMMON_PROTOCOL('Q', 'criterion'),
    defaultReviewInstruction: QA_REVIEW,
    reviewSkillAuthoring: 'A qa-review-skill (type "qa-review-skill") is the developer\'s domain rules for reviewing QA criteria of this project or group (for example "dates and times use the user\'s time zone"). The general checks are given by the global review instruction, so do not repeat them. It is never synced to agent folders; the description is a one-line summary shown in the picker. Do not put an output format in the skill.',
  },
};
