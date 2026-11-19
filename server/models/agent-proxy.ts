export type { AgentProxySettings, AgentProxyInput, AgentProxyCheck } from '../../contracts';

export interface ProxyConnection {
  url: string;
  username: string;
  password: string;
  ca?: string;
}
