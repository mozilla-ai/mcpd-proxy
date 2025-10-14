/**
 * Centralized API path constants for mcpd daemon endpoints.
 */

const API_BASE = "/api/v1";
const SERVERS_BASE = `${API_BASE}/servers`;
const HEALTH_BASE = `${API_BASE}/health`;

export const API_PATHS = {
  /**
   * Health check endpoint for all servers.
   */
  HEALTH_SERVERS: `${HEALTH_BASE}/servers`,

  /**
   * Resources listing endpoint for a specific server.
   */
  SERVER_RESOURCES: (serverName: string) =>
    `${SERVERS_BASE}/${encodeURIComponent(serverName)}/resources`,

  /**
   * Resource content endpoint for a specific server and URI.
   */
  RESOURCE_CONTENT: (serverName: string, uri: string) =>
    `${SERVERS_BASE}/${encodeURIComponent(serverName)}/resources/content?uri=${encodeURIComponent(uri)}`,

  /**
   * Prompts listing endpoint for a specific server.
   */
  SERVER_PROMPTS: (serverName: string) =>
    `${SERVERS_BASE}/${encodeURIComponent(serverName)}/prompts`,

  /**
   * Prompt get endpoint for a specific server and prompt name.
   */
  PROMPT_GET: (serverName: string, promptName: string) =>
    `${SERVERS_BASE}/${encodeURIComponent(serverName)}/prompts/${encodeURIComponent(promptName)}`,
} as const;
