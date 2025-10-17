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
  ListResourceTemplatesRequestSchema,
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
} from "@mozilla-ai/mcpd";
import type { Config } from "./config.js";

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
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new Error(
      `Invalid resource URI format: ${uri}. Expected format: mcpd://server/uri`,
    );
  }

  if (url.protocol !== "mcpd:") {
    throw new Error(
      `Invalid resource URI format: ${uri}. Expected format: mcpd://server/uri`,
    );
  }

  const server = url.hostname;
  const pathname = url.pathname;
  const originalUri = pathname.startsWith("/") ? pathname.slice(1) : pathname;

  if (!server || !originalUri) {
    throw new Error(
      `Invalid resource URI format: ${uri}. Missing path after server name`,
    );
  }

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
    // NOTE: getTools() automatically filters out unhealthy servers.
    // It checks health status and only returns tools from healthy servers,
    // ensuring tools from unreachable or unhealthy servers are not exposed.
    const allTools = await mcpdClient.getTools();
    const mcpTools = allTools.map((tool) => ({
      name: tool.name,
      description: tool.description || `Tool ${tool.name}`,
      inputSchema: tool.inputSchema || {
        type: "object",
        properties: {},
      },
    }));

    return { tools: mcpTools };
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
      return {
        content: [
          {
            type: "text",
            text: `Error executing tool '${fullToolName}': ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    // NOTE: getResources() automatically filters out unhealthy servers and
    // handles 501 Not Implemented responses. It returns resources with namespaced
    // names (serverName__resourceName) and includes _serverName and _uri fields.
    const allResources = await mcpdClient.getResources();

    // Transform SDK resources to MCP format with mcpd:// URIs.
    const mcpResources = allResources.map((resource) => ({
      uri: `mcpd://${resource._serverName}/${resource._uri}`,
      name: resource.name, // Already namespaced by SDK
      description:
        resource.description ||
        `Resource ${resource._resourceName} from ${resource._serverName} server`,
      mimeType: resource.mimeType,
    }));

    return { resources: mcpResources };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { server: serverName, originalUri } = parseResourceUri(
      request.params.uri,
    );

    // Use SDK's server-level readResource method which handles health checks
    // and error handling automatically.
    const contents =
      await mcpdClient.servers[serverName].readResource(originalUri);

    return { contents };
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    // NOTE: getResourceTemplates() automatically filters out unhealthy servers and
    // handles 501 Not Implemented responses. It returns templates with namespaced
    // names (serverName__templateName) and includes _serverName and _templateName fields.
    const allTemplates = await mcpdClient.getResourceTemplates();

    // Transform SDK templates to MCP format.
    const mcpTemplates = allTemplates.map((template) => ({
      name: template.name, // Already namespaced by SDK
      uriTemplate: template.uriTemplate,
      description: template.description,
      mimeType: template.mimeType,
    }));

    return { resourceTemplates: mcpTemplates };
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    // NOTE: getPrompts() automatically filters out unhealthy servers and
    // handles 501 Not Implemented responses. It returns prompts with namespaced
    // names (serverName__promptName).
    const allPrompts = await mcpdClient.getPrompts();

    return { prompts: allPrompts };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    // Use SDK's generatePrompt method which handles health checks, parsing,
    // and error handling automatically. The method expects the full namespaced
    // name (serverName__promptName) which is what the proxy receives.
    const result = await mcpdClient.generatePrompt(
      request.params.name,
      request.params.arguments as Record<string, string> | undefined,
    );

    return {
      description: result.description,
      messages: result.messages || [],
    };
  });

  server.setRequestHandler(PingRequestSchema, async () => {
    // Use SDK's getServerHealth to benefit from caching and consistent error handling.
    await mcpdClient.getServerHealth();
    return {};
  });

  return server;
}
