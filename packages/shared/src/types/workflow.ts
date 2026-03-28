export type WorkflowType = 'script_js' | 'script_python' | 'script_shell' | 'n8n' | 'pulse_editor';

export interface Workflow {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  type: WorkflowType;
  /** Source code (for script types) */
  code?: string | null;
  /** Integration config (for n8n / pulse_editor types, or script env overrides) */
  config: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkflowPayload {
  name: string;
  description?: string;
  type: WorkflowType;
  code?: string;
  config?: Record<string, unknown>;
}

export interface UpdateWorkflowPayload {
  name?: string;
  description?: string;
  code?: string;
  config?: Record<string, unknown>;
  isActive?: boolean;
}
