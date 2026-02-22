export type ServiceStatus = 'stopped' | 'starting' | 'running' | 'error';
export type AgentStatus = 'inactive' | 'active';

export interface ProjectService {
  id: string;
  projectId: string;
  name: string;
  command: string;
  sortOrder: number;
  status: ServiceStatus;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  description: string;
  services: ProjectService[];
  agentStatus: AgentStatus;
  agentSessionId?: string;
  createdAt: string;
  updatedAt: string;
}

// WebSocket event payloads
export interface ServiceStatusEvent {
  type: 'service_status';
  serviceId: string;
  projectId: string;
  status: ServiceStatus;
  pid?: number;
  exitCode?: number | null;
  error?: string;
}

export interface ServiceOutputEvent {
  type: 'service_output';
  serviceId: string;
  projectId: string;
  data: string;
  stream: 'stdout' | 'stderr';
}

export interface AgentStatusEvent {
  type: 'agent_status';
  projectId: string;
  status: AgentStatus;
  sessionId?: string;
}
