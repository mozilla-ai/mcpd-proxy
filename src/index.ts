#!/usr/bin/env node
/**
 * mcpd-proxy CLI entry point.
 *
 * Sets up STDIO transport and starts the MCP server.
 * All logging goes to stderr as stdout is reserved for MCP JSON-RPC protocol.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";
import { loadConfig } from "./config.js";

/**
 * Main entry point for mcpd-proxy.
 *
 * Loads configuration, creates MCP server, and connects via STDIO transport.
 */
async function main(): Promise<void> {
  const config = loadConfig();

  console.log("=".repeat(60));
  console.log("mcpd-proxy v0.0.1");
  console.log("=".repeat(60));
  console.log(`mcpd daemon: ${config.mcpdAddr}`);
  console.log(`API key: ${config.mcpdApiKey ? "***configured***" : "not set"}`);
  console.log("=".repeat(60));

  try {
    const server = createMcpServer(config);
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.log("[mcpd-proxy] Connected and ready");
  } catch (error) {
    console.error("[mcpd-proxy] Failed to start:", error);
    process.exit(1);
  }
}

main();
