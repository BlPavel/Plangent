import { agentPresets } from './presets';
import { initializeAgentPresets as seed } from '../../../infrastructure/db/repositories/agents/seed';
export function initializeAgentPresets(): void { seed(agentPresets); }
