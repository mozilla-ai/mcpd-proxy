/**
 * MCP server implementation for mcpd-proxy.
 *
 * This module creates an MCP server that proxies requests to the mcpd daemon,
 * exposing all mcpd-managed MCP servers through a unified interface.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  InitializeRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  PingRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { McpdClient } from '@mozilla-ai/mcpd';
import type { Config } from './config.js';
import { API_PATHS } from './apiPaths.js';

/**
 * Parse a prefixed name in the format "server__name" into its components.
 *
 * @param fullName - The full name (e.g., "time__get_current_time")
 * @param type - Type of item for error messages (e.g., "tool", "prompt")
 * @returns Object with server and name components
 * @throws Error if the name format is invalid
 */
function parsePrefixedName(fullName: string, type: string): { server: string; name: string } {
  const parts = fullName.split('__');

  if (parts.length < 2) {
    throw new Error(
      `Invalid ${type} name format: ${fullName}. Expected format: server__${type}_name`
    );
  }

  const server = parts[0];
  const name = parts.slice(1).join('__');

  return { server, name };
}

/**
 * Parse a resource URI in the format "mcpd://server/uri" into its components.
 *
 * @param uri - The resource URI (e.g., "mcpd://time/clock/utc")
 * @returns Object with server and original URI
 * @throws Error if the URI format is invalid
 */
function parseResourceUri(uri: string): { server: string; originalUri: string } {
  if (!uri.startsWith('mcpd://')) {
    throw new Error(`Invalid resource URI format: ${uri}. Expected format: mcpd://server/uri`);
  }

  const withoutScheme = uri.substring(7);
  const slashIndex = withoutScheme.indexOf('/');

  if (slashIndex === -1) {
    throw new Error(`Invalid resource URI format: ${uri}. Missing path after server name`);
  }

  const server = withoutScheme.substring(0, slashIndex);
  const originalUri = withoutScheme.substring(slashIndex + 1);

  return { server, originalUri };
}

/**
 * Create and configure the MCP server.
 *
 * Creates a singleton McpdClient instance and sets up all MCP protocol handlers.
 * The singleton client is reused across all requests to preserve caching.
 *
 * @param config - Configuration object with mcpd address and API key.
 * @returns Configured MCP Server instance.
 */
export function createMcpServer(config: Config): Server {
  const mcpdClient = new McpdClient({
    apiEndpoint: config.mcpdAddr,
    apiKey: config.mcpdApiKey,
    healthCacheTtl: 10,
    serverCacheTtl: 60,
  });

  const server = new Server(
    {
      name: 'mcpd-proxy',
      version: '0.0.1',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    }
  );

  server.setRequestHandler(InitializeRequestSchema, async () => {
    return {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
      serverInfo: {
        name: 'mcpd-proxy',
        version: '0.0.1',
      },
    };
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    try {
      const allTools = await mcpdClient.getTools();
      const mcpTools = [];

      for (const [serverName, toolSchemas] of Object.entries(allTools)) {
        for (const tool of toolSchemas) {
          mcpTools.push({
            name: `${serverName}__${tool.name}`,
            description: tool.description || `Tool ${tool.name} from ${serverName} server`,
            inputSchema: tool.inputSchema || {
              type: 'object',
              properties: {},
            },
          });
        }
      }

      return { tools: mcpTools };
    } catch (error) {
      console.error('[mcpd-proxy] Error listing tools:', error);
      throw error;
    }
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const { server: serverName, name: tool } = parsePrefixedName(request.params.name, 'tool');
      const result = await mcpdClient._performCall(
        serverName,
        tool,
        (request.params.arguments as Record<string, unknown>) || {}
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      console.error(`[mcpd-proxy] Tool execution failed:`, error);

      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    try {
      const allServers = await mcpdClient.getServers();
      const mcpResources = [];

      for (const serverName of allServers) {
        try {
          const response = await fetch(`${config.mcpdAddr}${API_PATHS.SERVER_RESOURCES(serverName)}`, {
            headers: config.mcpdApiKey ? { Authorization: `Bearer ${config.mcpdApiKey}` } : {},
          });

          if (!response.ok) {
            continue;
          }

          const data = await response.json();
          const resources = data.resources || [];

          for (const resource of resources) {
            mcpResources.push({
              uri: `mcpd://${serverName}/${resource.uri}`,
              name: `${serverName}__${resource.name}`,
              description:
                resource.description || `Resource ${resource.name} from ${serverName} server`,
              mimeType: resource.mimeType,
            });
          }
        } catch (error) {
          console.error(`[mcpd-proxy] Error listing resources for '${serverName}':`, error);
        }
      }

      return { resources: mcpResources };
    } catch (error) {
      console.error('[mcpd-proxy] Error listing resources:', error);
      throw error;
    }
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    try {
      const { server: serverName, originalUri } = parseResourceUri(request.params.uri);

      const response = await fetch(
        `${config.mcpdAddr}${API_PATHS.RESOURCE_CONTENT(serverName, originalUri)}`,
        {
          headers: config.mcpdApiKey ? { Authorization: `Bearer ${config.mcpdApiKey}` } : {},
        }
      );

      if (!response.ok) {
        throw new Error(`Resource read failed: ${response.status} ${response.statusText}`);
      }

      const contents = await response.json();
      return { contents };
    } catch (error) {
      console.error('[mcpd-proxy] Resource read failed:', error);
      throw error;
    }
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    try {
      const allServers = await mcpdClient.getServers();
      const mcpPrompts = [];

      for (const serverName of allServers) {
        try {
          const response = await fetch(`${config.mcpdAddr}${API_PATHS.SERVER_PROMPTS(serverName)}`, {
            headers: config.mcpdApiKey ? { Authorization: `Bearer ${config.mcpdApiKey}` } : {},
          });

          if (!response.ok) {
            continue;
          }

          const data = await response.json();
          const prompts = data.prompts || [];

          for (const prompt of prompts) {
            mcpPrompts.push({
              name: `${serverName}__${prompt.name}`,
              description: prompt.description || `Prompt ${prompt.name} from ${serverName} server`,
              arguments: prompt.arguments,
            });
          }
        } catch (error) {
          console.error(`[mcpd-proxy] Error listing prompts for '${serverName}':`, error);
        }
      }

      return { prompts: mcpPrompts };
    } catch (error) {
      console.error('[mcpd-proxy] Error listing prompts:', error);
      throw error;
    }
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    try {
      const { server: serverName, name } = parsePrefixedName(request.params.name, 'prompt');

      const response = await fetch(`${config.mcpdAddr}${API_PATHS.PROMPT_GET(serverName, name)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.mcpdApiKey ? { Authorization: `Bearer ${config.mcpdApiKey}` } : {}),
        },
        body: JSON.stringify({
          arguments: request.params.arguments || {},
        }),
      });

      if (!response.ok) {
        throw new Error(`Prompt generation failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      return {
        description: result.description,
        messages: result.messages || [],
      };
    } catch (error) {
      console.error('[mcpd-proxy] Prompt generation failed:', error);
      throw error;
    }
  });

  server.setRequestHandler(PingRequestSchema, async () => {
    const response = await fetch(`${config.mcpdAddr}${API_PATHS.HEALTH_SERVERS}`, {
      headers: config.mcpdApiKey ? { Authorization: `Bearer ${config.mcpdApiKey}` } : {},
    });

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }

    return {};
  });

  return server;
}
