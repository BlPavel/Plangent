import type { AgentSession } from '../../../core/agents';
export type ToolEvent = (name: string, payload: Record<string, unknown>) => void;
export interface ToolDefinition {
  description: string;
  fields: Record<string, unknown>;
  roles: Record<string, number>;
  required: string[];
  validateStrings: string[];
  handle(session: AgentSession, args: Record<string, unknown>, emit: ToolEvent): Promise<unknown>;
}
export function defineTools<T extends Record<string, { description: string; fields: Record<string, unknown> }>>(
  definitions: T,
  access: Record<keyof T, Pick<ToolDefinition, 'roles' | 'required' | 'validateStrings'>>,
  handler: (name: keyof T, session: AgentSession, args: Record<string, unknown>, emit: ToolEvent) => Promise<unknown>,
): Record<keyof T, ToolDefinition> {
  return Object.fromEntries(Object.entries(definitions).map(([name, definition]) => [name, {
    ...definition, ...access[name], handle: (session: AgentSession, args: Record<string, unknown>, emit: ToolEvent) => handler(name, session, args, emit),
  }])) as Record<keyof T, ToolDefinition>;
}
