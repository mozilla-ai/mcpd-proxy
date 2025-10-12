/**
 * Configuration management for mcpd-proxy.
 * Loads configuration from environment variables.
 */

/**
 * Configuration interface for mcpd-proxy.
 */
export interface Config {
  /** mcpd daemon address (e.g., http://localhost:8090). */
  mcpdAddr: string;

  /** Optional API key for mcpd authentication. */
  mcpdApiKey?: string;
}

/**
 * Load configuration from environment variables.
 *
 * Environment variables:
 * - MCPD_ADDR: mcpd daemon address (default: http://localhost:8090)
 * - MCPD_API_KEY: Optional API key for mcpd authentication
 *
 * @returns Configuration object.
 */
export function loadConfig(): Config {
  return {
    mcpdAddr: process.env.MCPD_ADDR || 'http://localhost:8090',
    mcpdApiKey: process.env.MCPD_API_KEY,
  };
}
