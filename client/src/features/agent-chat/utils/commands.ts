export interface ChatCommand { name: string; description: string; source?: 'plangent'; insert?: string }

/** Keep both commands when their names collide; the explicit agent namespace bypasses Plangent. */
export function mergeCommands(agent: ChatCommand[], plangent: ChatCommand[]): ChatCommand[] {
  return [...plangent, ...agent.map(command => ({
    ...command, insert: plangent.some(own => own.name === command.name) ? 'agent:' + command.name : command.name,
  }))];
}

export function commandSuggestions(commands: ChatCommand[], query: string) {
  return commands.filter(command => command.name.toLowerCase().includes(query.toLowerCase())).slice(0, 50)
    .map(command => ({ value: command.insert ?? command.name,
      label: '/' + command.name + (command.source === 'plangent' ? ' (plangent)' : ''), detail: command.description, command: true }));
}
