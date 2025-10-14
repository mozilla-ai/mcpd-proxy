import { describe, it, expect } from "vitest";
import { parsePrefixedName, parseResourceUri } from "../../src/server";

describe("parsePrefixedName", () => {
  it("should parse valid prefixed names", () => {
    const result = parsePrefixedName("time__get_current_time", "tool");
    expect(result).toEqual({
      server: "time",
      name: "get_current_time",
    });
  });

  it("should handle names with multiple underscores", () => {
    const result = parsePrefixedName("server__tool__with__underscores", "tool");
    expect(result).toEqual({
      server: "server",
      name: "tool__with__underscores",
    });
  });

  it("should handle different types", () => {
    const result = parsePrefixedName("github__create_issue", "prompt");
    expect(result).toEqual({
      server: "github",
      name: "create_issue",
    });
  });

  it("should throw error for invalid format without separator", () => {
    expect(() => parsePrefixedName("invalid", "tool")).toThrow(
      "Invalid tool name format: invalid. Expected format: server__tool_name",
    );
  });

  it("should throw error for format with only one part", () => {
    expect(() => parsePrefixedName("server_only", "tool")).toThrow(
      "Invalid tool name format: server_only",
    );
  });

  it("should throw error for empty string", () => {
    expect(() => parsePrefixedName("", "tool")).toThrow(
      "Invalid tool name format: ",
    );
  });
});

describe("parseResourceUri", () => {
  it("should parse valid mcpd:// URIs", () => {
    const result = parseResourceUri("mcpd://time/clock/utc");
    expect(result).toEqual({
      server: "time",
      originalUri: "clock/utc",
    });
  });

  it("should handle simple paths", () => {
    const result = parseResourceUri("mcpd://filesystem/file.txt");
    expect(result).toEqual({
      server: "filesystem",
      originalUri: "file.txt",
    });
  });

  it("should handle deep nested paths", () => {
    const result = parseResourceUri("mcpd://db/users/123/profile/avatar");
    expect(result).toEqual({
      server: "db",
      originalUri: "users/123/profile/avatar",
    });
  });

  it("should throw error for invalid scheme", () => {
    expect(() => parseResourceUri("http://server/path")).toThrow(
      "Invalid resource URI format: http://server/path. Expected format: mcpd://server/uri",
    );
  });

  it("should throw error for missing path after server", () => {
    expect(() => parseResourceUri("mcpd://server")).toThrow(
      "Invalid resource URI format: mcpd://server. Missing path after server name",
    );
  });

  it("should throw error for URI without server name", () => {
    expect(() => parseResourceUri("mcpd:///path")).toThrow(
      "Invalid resource URI format: mcpd:///path. Missing path after server name",
    );
  });

  it("should throw error for empty string", () => {
    expect(() => parseResourceUri("")).toThrow(
      "Invalid resource URI format: . Expected format: mcpd://server/uri",
    );
  });
});
