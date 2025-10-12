# mcpd-proxy

An MCP (Model Context Protocol) server that acts as a proxy between IDEs and the [`mcpd`](https://github.com/mozilla-ai/mcpd) daemon, exposing all `mcpd`-managed MCP servers through a unified interface.

## Overview

```
┌─────────────┐   STDIO/JSON-RPC    ┌──────────────┐    HTTP/REST     ┌──────────┐
│  IDE/Editor │ ◄─────────────────► │  mcpd-proxy  │ ◄───────────────►│   mcpd   │
│ (VS Code,   │     MCP Protocol    │  MCP Server  │   Uses mcpd SDK  │  daemon  │
│  Cursor)    │                     │              │                  │          │
└─────────────┘                     └──────────────┘                  └──────────┘
```

`mcpd-proxy` aggregates tools, resources, and prompts from multiple MCP servers managed by `mcpd` into a single MCP interface, making it easy for IDEs to access all capabilities without managing individual server connections.

## Features

- Unified Interface: Single MCP server exposing all `mcpd`-managed tools
- Tool Aggregation: Tools from all servers with `server__tool` naming convention
- Resource Support: Access resources from all servers with `mcpd://` URIs
- Prompt Support: Aggregate prompts from all servers
- Efficient Caching: Leverages SDK caching for health checks and tool schemas
- Zero Configuration: Works out of the box with sensible defaults
- TypeScript: Built with `TypeScript` for type safety

## Prerequisites

- `Node.js` 18 or higher
- `mcpd` daemon running and accessible
- `mcpd` SDK (automatically installed as a dependency)

## Installation

```bash
# Clone or navigate to the project directory
cd mcpd-proxy

# Install dependencies
npm install

# Build the project
npm run build
```

## Configuration

`mcpd-proxy` is configured via environment variables:

| Variable       | Description                              | Default                 |
| -------------- | ---------------------------------------- | ----------------------- |
| `MCPD_ADDR`    | `mcpd` daemon address                    | `http://localhost:8090` |
| `MCPD_API_KEY` | Optional API key for `mcpd` authentication | _(not set)_           |

## Usage

### Running Directly

```bash
# With default configuration
node dist/index.js

# With custom mcpd address
MCPD_ADDR=http://localhost:8090 node dist/index.js

# With API key
MCPD_ADDR=http://localhost:8090 MCPD_API_KEY=your-key node dist/index.js
```

### VS Code Setup

Build the project:

```bash
npm run build
```

Add to your VS Code MCP settings file (location varies by platform):

```json
{
  "servers": {
    "mcpd": {
      "type": "stdio",
      "command": "node",
      "args": ["<path-to-mcpd-proxy>/dist/index.js"],
      "env": {
        "MCPD_ADDR": "http://localhost:8090"
      }
    }
  }
}
```

Replace `<path-to-mcpd-proxy>` with the absolute path to your installation.

Reload VS Code: `Cmd+Shift+P` → "Developer: Reload Window"

Verify the connection in the MCP panel to see available tools.

### Cursor Setup

Build the project:

```bash
npm run build
```

Create or edit `.cursor/mcp.json` in your project directory, or `~/.cursor/mcp.json` for global configuration:

```json
{
  "mcpServers": {
    "mcpd": {
      "command": "node",
      "args": ["<path-to-mcpd-proxy>/dist/index.js"],
      "env": {
        "MCPD_ADDR": "http://localhost:8090"
      }
    }
  }
}
```

Replace `<path-to-mcpd-proxy>` with the absolute path to your installation, or use `${workspaceFolder}` for relative paths.

Reload Cursor to apply the configuration.

## Development

### Project Structure

```
mcpd-proxy/
├── src/
│   ├── index.ts               # CLI entry point
│   ├── server.ts              # MCP server implementation
│   ├── config.ts              # Configuration loader
│   └── apiPaths.ts            # API endpoint constants
├── dist/                      # Build output (gitignored)
├── examples/
│   ├── vscode-config.json     # VS Code configuration example
│   └── cursor-config.json     # Cursor configuration example
├── package.json               # npm package configuration
├── package-lock.json          # npm dependency lock file
├── tsconfig.json              # TypeScript compiler configuration
├── eslint.config.mts          # ESLint configuration
├── .prettierrc                # Prettier code formatter config
├── .prettierignore            # Prettier ignore patterns
├── .gitignore                 # Git ignore patterns
└── README.md                  # This file
```

### Development Workflow

```bash
# Install dependencies
npm install

# Build once
npm run build

# Watch mode (auto-rebuild on changes)
npm run watch

# Type check without building
npm run typecheck
```

### Manual Testing

Test the MCP protocol directly using `JSON-RPC` over `stdio`:

```bash
# Test initialize
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | node dist/index.js

# Test list tools
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | node dist/index.js
```

## Naming Conventions

### Tools

Tools are exposed with the format: `{server}__{tool_name}`

Examples:
- `time__get_current_time` - `get_current_time` tool from `time` server
- `github__create_issue` - `create_issue` tool from `github` server
- `fetch__get_url` - `get_url` tool from `fetch` server

This naming convention prevents tool name collisions between servers and makes it clear which server provides each tool.

### Resources

Resources use a custom URI scheme: `mcpd://{server}/{resource_uri}`

Examples:
- `mcpd://filesystem/documents/file.txt`
- `mcpd://database/users/123`

### Prompts

Prompts follow the same naming convention as tools: `{server}__{prompt_name}`

## Architecture

### Singleton `McpdClient`

`mcpd-proxy` creates a single instance of `McpdClient` at startup and reuses it for all requests. This is essential for:

- Caching: Health check cache (10s `TTL`) and tool schema cache (60s `TTL`)
- Performance: Avoids creating new `HTTP` connections for each request
- Efficiency: Reduces load on `mcpd` daemon

```typescript
const mcpdClient = new McpdClient({
  apiEndpoint: config.mcpdAddr,
  apiKey: config.mcpdApiKey,
  healthCacheTtl: 10,
  serverCacheTtl: 60,
});
```

### MCP Protocol Handlers

The proxy implements the following MCP protocol handlers:

- `initialize` - Handshake with IDE, declares capabilities
- `tools/list` - Aggregates tools from all `mcpd` servers
- `tools/call` - Parses tool name and forwards to `mcpd`
- `resources/list` - Aggregates resources from all servers
- `resources/read` - Forwards resource read requests to `mcpd`
- `prompts/list` - Aggregates prompts from all servers
- `prompts/get` - Forwards prompt requests to `mcpd`
- `ping` - Health check endpoint

## Troubleshooting

### Cannot connect to mcpd daemon

Cause: `mcpd` daemon is not running or not accessible

Solution:
1. Verify `mcpd` is running: `curl http://localhost:8090/api/v1/servers`
2. Check `MCPD_ADDR` environment variable is correct
3. Ensure no firewall blocking the connection

### Server not found

Cause: Requested server doesn't exist in `mcpd`

Solution:
1. List available servers: `curl http://localhost:8090/api/v1/servers`
2. Check server is configured in `mcpd`
3. Verify server is healthy: `curl http://localhost:8090/api/v1/health/servers/<server-name>`

### VS Code not showing tools

Cause: VS Code may not have recognized the MCP server

Solution:
1. Check VS Code developer console for errors (Help → Toggle Developer Tools)
2. Verify the path to `dist/index.js` is correct and absolute
3. Reload VS Code: `Cmd+Shift+P` → "Developer: Reload Window"
4. Check `mcpd` daemon is running and accessible

### Tools listed but execution fails

Cause: Server may be unhealthy or tool doesn't exist

Solution:
1. Check server health via `mcpd` API
2. Verify tool exists on the server
3. Check `mcpd` logs for errors
4. Check `stderr` output from `mcpd-proxy` for detailed error messages

## Logging

`mcpd-proxy` logs to `stderr` (`stdout` is reserved for MCP protocol):

```
============================================================
mcpd-proxy v0.0.1
============================================================
mcpd daemon: http://localhost:8090
API key: not set
============================================================
[mcpd-proxy] Connected and ready
[mcpd-proxy] Error listing tools: <error details>
```

## Future Enhancements

- Dynamic tool list updates (`notifications/tools/list_changed`)
- Server filtering via `MCPD_SERVERS` environment variable
- Improved unhealthy server handling
- Comprehensive test suite
- Publish to `npm` for `npx` usage

## Related Projects

- [`mcpd`](https://github.com/mozilla-ai/mcpd) - The MCP daemon this proxy connects to
- [`mcpd-sdk-javascript`](https://github.com/mozilla-ai/mcpd-sdk-javascript) - `TypeScript` SDK for `mcpd`
- [`mcpd-sdk-python`](https://github.com/mozilla-ai/mcpd-sdk-python) - Python SDK for `mcpd`

## License

Apache-2.0

## Contributing

See the main [`mcpd` repository](https://github.com/mozilla-ai/mcpd) for contribution guidelines.
