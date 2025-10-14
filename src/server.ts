/**
 * MCP server implementation for mcpd-proxy.
 *
 * This module creates an MCP server that proxies requests to the mcpd daemon,
 * exposing all mcpd-managed MCP servers through a unified interface.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  InitializeRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  PingRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  McpdClient,
  ToolNotFoundError,
  ToolExecutionError,
  ServerNotFoundError,
  ServerUnhealthyError,
  ConnectionError,
  AuthenticationError,
  TimeoutError,
  type Resources,
  type Prompts,
  type GeneratePromptResponseBody,
  type ResourceContent,
  type ErrorModel,
} from "@mozilla-ai/mcpd";
import type { Config } from "./config.js";
import { API_PATHS } from "./apiPaths.js";

/**
 * Parse a prefixed name in the format "server__name" into its components.
 *
 * @param fullName - The full name (e.g., "time__get_current_time")
 * @param type - Type of item for error messages (e.g., "tool", "prompt")
 * @returns Object with server and name components
 * @throws Error if the name format is invalid
 */
export function parsePrefixedName(
  fullName: string,
  type: string,
): { server: string; name: string } {
  const parts = fullName.split("__");

  if (parts.length < 2) {
    throw new Error(
      `Invalid ${type} name format: ${fullName}. Expected format: server__${type}_name`,
    );
  }

  const server = parts[0];
  const name = parts.slice(1).join("__");

  return { server, name };
}

/**
 * Parse a resource URI in the format "mcpd://server/uri" into its components.
 *
 * @param uri - The resource URI (e.g., "mcpd://time/clock/utc")
 * @returns Object with server and original URI
 * @throws Error if the URI format is invalid
 */
export function parseResourceUri(uri: string): {
  server: string;
  originalUri: string;
} {
  if (!uri.startsWith("mcpd://")) {
    throw new Error(
      `Invalid resource URI format: ${uri}. Expected format: mcpd://server/uri`,
    );
  }

  const withoutScheme = uri.substring(7);
  const slashIndex = withoutScheme.indexOf("/");

  if (slashIndex === -1) {
    throw new Error(
      `Invalid resource URI format: ${uri}. Missing path after server name`,
    );
  }

  const server = withoutScheme.substring(0, slashIndex);
  const originalUri = withoutScheme.substring(slashIndex + 1);

  if (!server) {
    throw new Error(
      `Invalid resource URI format: ${uri}. Missing path after server name`,
    );
  }

  return { server, originalUri };
}

/**
 * Parse an error response from the mcpd API to extract a meaningful error message.
 *
 * @param response - The failed HTTP response
 * @returns A formatted error message with details from the ErrorModel
 */
async function parseErrorResponse(response: Response): Promise<string> {
  try {
    const errorData = (await response.json()) as ErrorModel;
    let message = errorData.detail || errorData.title || "Unknown error";

    // Include field-level validation errors if present.
    if (errorData.errors && errorData.errors.length > 0) {
      const details = errorData.errors
        .map((e) => `${e.location}: ${e.message}`)
        .join(", ");
      message += ` (${details})`;
    }

    return message;
  } catch {
    // If we can't parse JSON, return generic HTTP error.
    return `HTTP ${response.status}: ${response.statusText}`;
  }
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
      name: "mcpd-proxy",
      version: "0.0.1",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    },
  );

  server.setRequestHandler(InitializeRequestSchema, async () => {
    return {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
      serverInfo: {
        name: "mcpd-proxy",
        version: "0.0.1",
      },
    };
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    try {
      // NOTE: getToolSchemas() automatically filters out unhealthy servers.
      // It checks health status and only returns tools from healthy servers,
      // ensuring tools from unreachable or unhealthy servers are not exposed.
      const allTools = await mcpdClient.getToolSchemas();
      const mcpTools = allTools.map((tool) => ({
        name: tool.name,
        description: tool.description || `Tool ${tool.name}`,
        inputSchema: tool.inputSchema || {
          type: "object",
          properties: {},
        },
      }));

      return { tools: mcpTools };
    } catch (error) {
      console.error("[mcpd-proxy] Error listing tools:", error);
      throw error;
    }
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const fullToolName = request.params.name;

    try {
      const { server: serverName, name: tool } = parsePrefixedName(
        fullToolName,
        "tool",
      );
      const result = await mcpdClient.servers[serverName].callTool(
        tool,
        (request.params.arguments as Record<string, unknown>) || {},
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      // Handle SDK-specific errors with contextual messages.
      if (error instanceof ToolNotFoundError) {
        console.error(
          `[mcpd-proxy] Tool not found: ${error.toolName} on ${error.serverName}`,
        );
        return {
          content: [
            {
              type: "text",
              text: `Tool '${fullToolName}' not found. Run the tools/list request to see available tools.`,
            },
          ],
          isError: true,
        };
      }

      if (error instanceof ToolExecutionError) {
        console.error(`[mcpd-proxy] Tool execution failed:`, error.errorModel);
        let message = `Tool '${fullToolName}' execution failed: ${error.message}`;

        // Include detailed validation errors from mcpd API.
        if (error.errorModel?.errors && error.errorModel.errors.length > 0) {
          const details = error.errorModel.errors
            .map((e) => `  ${e.location}: ${e.message}`)
            .join("\n");
          message += `\n\nValidation errors:\n${details}`;
        }

        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }

      if (error instanceof ServerNotFoundError) {
        console.error(`[mcpd-proxy] Server not found: ${error.serverName}`);
        return {
          content: [
            {
              type: "text",
              text: `Tool '${fullToolName}' is not available. The underlying service may have been removed or is not configured.`,
            },
          ],
          isError: true,
        };
      }

      if (error instanceof ServerUnhealthyError) {
        console.error(
          `[mcpd-proxy] Server unhealthy: ${error.serverName} (${error.healthStatus})`,
        );
        return {
          content: [
            {
              type: "text",
              text: `Tool '${fullToolName}' is temporarily unavailable. Please try again later.`,
            },
          ],
          isError: true,
        };
      }

      if (error instanceof ConnectionError) {
        console.error(`[mcpd-proxy] Connection error:`, error.message);
        return {
          content: [
            {
              type: "text",
              text: `Cannot connect to mcpd daemon. Please ensure mcpd is running and accessible.`,
            },
          ],
          isError: true,
        };
      }

      if (error instanceof AuthenticationError) {
        console.error(`[mcpd-proxy] Authentication error:`, error.message);
        return {
          content: [
            {
              type: "text",
              text: `Authentication failed. Please check your MCPD_API_KEY configuration.`,
            },
          ],
          isError: true,
        };
      }

      if (error instanceof TimeoutError) {
        console.error(
          `[mcpd-proxy] Timeout error: ${error.operation} (${error.timeout}ms)`,
        );
        return {
          content: [
            {
              type: "text",
              text: `Tool '${fullToolName}' execution timed out. The operation may be taking too long. Please try again.`,
            },
          ],
          isError: true,
        };
      }

      // Generic fallback for unexpected errors.
      console.error(`[mcpd-proxy] Unexpected error:`, error);
      return {
        content: [
          {
            type: "text",
            text: `Error executing tool '${fullToolName}': ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    try {
      const allServers = await mcpdClient.listServers();
      const mcpResources = [];

      for (const serverName of allServers) {
        try {
          const response = await fetch(
            `${config.mcpdAddr}${API_PATHS.SERVER_RESOURCES(serverName)}`,
            {
              headers: config.mcpdApiKey
                ? { Authorization: `Bearer ${config.mcpdApiKey}` }
                : {},
            },
          );

          if (!response.ok) {
            continue;
          }

          const data = (await response.json()) as Resources;
          const resources = data.resources || [];

          for (const resource of resources) {
            mcpResources.push({
              uri: `mcpd://${serverName}/${resource.uri}`,
              name: `${serverName}__${resource.name}`,
              description:
                resource.description ||
                `Resource ${resource.name} from ${serverName} server`,
              mimeType: resource.mimeType,
            });
          }
        } catch (error) {
          console.error(
            `[mcpd-proxy] Error listing resources for '${serverName}':`,
            error,
          );
        }
      }

      return { resources: mcpResources };
    } catch (error) {
      console.error("[mcpd-proxy] Error listing resources:", error);
      throw error;
    }
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    try {
      const { server: serverName, originalUri } = parseResourceUri(
        request.params.uri,
      );

      const response = await fetch(
        `${config.mcpdAddr}${API_PATHS.RESOURCE_CONTENT(serverName, originalUri)}`,
        {
          headers: config.mcpdApiKey
            ? { Authorization: `Bearer ${config.mcpdApiKey}` }
            : {},
        },
      );

      if (!response.ok) {
        const errorMsg = await parseErrorResponse(response);
        throw new Error(`Resource read failed: ${errorMsg}`);
      }

      const contents = (await response.json()) as ResourceContent[];
      return { contents };
    } catch (error) {
      console.error("[mcpd-proxy] Resource read failed:", error);
      throw error;
    }
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    try {
      const allServers = await mcpdClient.listServers();
      const mcpPrompts = [];

      for (const serverName of allServers) {
        try {
          const response = await fetch(
            `${config.mcpdAddr}${API_PATHS.SERVER_PROMPTS(serverName)}`,
            {
              headers: config.mcpdApiKey
                ? { Authorization: `Bearer ${config.mcpdApiKey}` }
                : {},
            },
          );

          if (!response.ok) {
            continue;
          }

          const data = (await response.json()) as Prompts;
          const prompts = data.prompts || [];

          for (const prompt of prompts) {
            mcpPrompts.push({
              name: `${serverName}__${prompt.name}`,
              description:
                prompt.description ||
                `Prompt ${prompt.name} from ${serverName} server`,
              arguments: prompt.arguments,
            });
          }
        } catch (error) {
          console.error(
            `[mcpd-proxy] Error listing prompts for '${serverName}':`,
            error,
          );
        }
      }

      return { prompts: mcpPrompts };
    } catch (error) {
      console.error("[mcpd-proxy] Error listing prompts:", error);
      throw error;
    }
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    try {
      const { server: serverName, name } = parsePrefixedName(
        request.params.name,
        "prompt",
      );

      const response = await fetch(
        `${config.mcpdAddr}${API_PATHS.PROMPT_GET(serverName, name)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(config.mcpdApiKey
              ? { Authorization: `Bearer ${config.mcpdApiKey}` }
              : {}),
          },
          body: JSON.stringify({
            arguments: request.params.arguments || {},
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Prompt generation failed: ${response.status} ${response.statusText}`,
        );
      }

      const result = (await response.json()) as GeneratePromptResponseBody;

      return {
        description: result.description,
        messages: result.messages || [],
      };
    } catch (error) {
      console.error("[mcpd-proxy] Prompt generation failed:", error);
      throw error;
    }
  });

  server.setRequestHandler(PingRequestSchema, async () => {
    // Use SDK's getServerHealth to benefit from caching and consistent error handling.
    await mcpdClient.getServerHealth();
    return {};
  });

  return server;
}
