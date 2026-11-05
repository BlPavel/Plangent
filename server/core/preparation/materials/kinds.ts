import type { MaterialType } from './index';
import type { LibraryItemType } from '../../../models';

/** Texts and library types of a preparation section; kept free of imports from the library to avoid cycles. */
export interface MaterialKind {
  templateType: LibraryItemType; reviewInstructionType: LibraryItemType; reviewSkillType: LibraryItemType;
  idPrefix: 'D' | 'Q'; title: string; defaultTemplate: string; protocol: string;
  defaultReviewInstruction: string; reviewSkillAuthoring: string;
}

const COMMON_PROTOCOL = (id: 'D' | 'Q', noun: string) => `## Plangent protocol (do not remove)

The document is free-form Markdown. Read it with get_material and save its complete text only with submit_material, passing the version from get_material. If a developer edit causes a version conflict, read it again and reapply your changes without overwriting theirs.

- The developer's text and request take precedence over the template. The template is a suggestion for an empty document; do not restructure an existing draft to fit it. Sections can be combined, omitted, or changed.
- If asked only to format text, preserve its meaning, decisions, and wording.
- Mention contradictions and gaps in chat; do not silently fix them.
- A ${noun} may have a stable identifier: bold \`**${id}1**\` at the start of a line or heading, then \`**${id}2**\`, and so on. Never renumber or reuse existing identifiers; plan steps and review remarks refer to them.
- Link analysis materials using [[section]] or [[section/file]]; the section and file must exist.
- Write diagrams as Mermaid in a \`\`\`mermaid code block. Show only what is described; do not invent components or relationships.
- Only the developer marks a section ready. Do not mark it ready or treat stopping work as readiness.
- Write preparation documents in Russian.`;

export const ARCHITECTURE_TEMPLATE = `# Architecture

A flexible outline for an empty document. Combine, omit, or change sections; completeness does not determine readiness. Write the document in Russian.

## Context and boundaries
Describe what changes and what does not, the sources of requirements (links to analysis), and applicable project rules.

## Components and interactions
Describe affected parts and their responsibilities, the main flow, state ownership, errors, and concurrency where relevant. Distinguish existing from proposed components. Use a diagram only when text is insufficient.

## Decisions and constraints
**D1** Decision, rationale, and consequences.

## Exceptions and open questions
Record deliberate exceptions to rules and unresolved questions.

Do not retell the project, list classes, or turn the document into an implementation plan.`;

export const QA_TEMPLATE = `# QA

A flexible outline for an empty document. Combine, omit, or change sections; completeness does not determine readiness. Write the document in Russian.

A criterion turns a requirement into behavior verifiable by code and automated tests: condition, action, expected result, boundary, and basis (a link to analysis).

**Q1** Condition -> action -> expected result. Basis: [[section]].

Distinguish explicit requirements, proposed clarifications, and open questions. Do not invent behavior absent from the materials; raise ambiguity as a question. Code structure rules belong in architecture, not QA.`;

const ARCHITECTURE_REVIEW = `# Architecture review
1. Check that the document follows the analysis materials and the current code. QA and the plan are not grounds for this review: they depend on the architecture.
2. Check the project's architectural rules: name the exact rule and the dependency that violates it. Explicit exceptions are allowed.
3. Check responsibility and data ownership of the affected components, error handling and concurrent operations where they matter.
4. Check that text and diagrams agree, component names are uniform, and existing parts are told apart from proposed ones.
5. Look for needless complication and for details that free interpretation would change.
Back every remark with a place of the document (decision id or quote), the code or the requirement, and the consequence. Keep violations apart from matters of taste.`;

const QA_REVIEW = `# QA review
1. Check that every criterion rests on the analysis materials and that no behaviour is invented. Find requirements without a criterion and criteria without a basis.
2. Check that ambiguities are raised as questions and are not decided silently; a strengthening of a requirement needs a decision.
3. Check that criteria agree with each other and with the ready architecture.
4. Check that boundaries, errors and expected results are exact and observable by code and automated tests.
Back every remark with a place of the document (criterion id or quote) and the source it conflicts with. Keep violations apart from suggestions.`;

export const MATERIAL_KINDS: Record<MaterialType, MaterialKind> = {
  architecture: {
    templateType: 'architecture-template', reviewInstructionType: 'architecture-review-instruction',
    reviewSkillType: 'architecture-review-skill', idPrefix: 'D', title: 'Архитектура', defaultTemplate: ARCHITECTURE_TEMPLATE,
    protocol: COMMON_PROTOCOL('D', 'decision'), defaultReviewInstruction: ARCHITECTURE_REVIEW,
    reviewSkillAuthoring: 'An architecture-review-skill (type "architecture-review-skill") is the developer\'s rules for reviewing the architecture of a task in this project or group: module boundaries, allowed dependencies, ownership conventions. The general checks are given by the global review instruction, so do not repeat them. It is never synced to agent folders; the description is a one-line summary shown in the picker. Do not put an output format in the skill.',
  },
  qa: {
    templateType: 'qa-template', reviewInstructionType: 'qa-review-instruction', reviewSkillType: 'qa-review-skill',
    idPrefix: 'Q', title: 'QA', defaultTemplate: QA_TEMPLATE, protocol: COMMON_PROTOCOL('Q', 'criterion'),
    defaultReviewInstruction: QA_REVIEW,
    reviewSkillAuthoring: 'A qa-review-skill (type "qa-review-skill") is the developer\'s domain rules for reviewing QA criteria of this project or group (for example "dates and times use the user\'s time zone"). The general checks are given by the global review instruction, so do not repeat them. It is never synced to agent folders; the description is a one-line summary shown in the picker. Do not put an output format in the skill.',
  },
};
