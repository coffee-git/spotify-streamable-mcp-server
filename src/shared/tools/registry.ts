/** Shared tools available in Node.js and Cloudflare Workers. */
import type { ZodObject, ZodRawShape } from 'zod';
import { healthTool } from './health.js';
import { playerStatusTool } from './player-status.js';
import { searchCatalogTool } from './search-catalog.js';
import { spotifyControlTool } from './spotify-control.js';
import { spotifyLibraryTool } from './spotify-library.js';
import { spotifyPlaylistTool } from './spotify-playlist.js';
import { spotifyUserDataTool } from './spotify-user-data.js';
import type { ToolContext, ToolResult } from './types.js';

export type { SharedToolDefinition, ToolContext, ToolResult } from './types.js';
export { defineTool } from './types.js';

export interface RegisteredTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: ZodObject<ZodRawShape>;
  outputSchema?: ZodRawShape;
  annotations?: Record<string, unknown>;
  handler: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
}

export const sharedTools: RegisteredTool[] = [
  healthTool, playerStatusTool, searchCatalogTool, spotifyControlTool,
  spotifyPlaylistTool, spotifyLibraryTool, spotifyUserDataTool,
] as unknown as RegisteredTool[];

export function getSharedTool(name: string) { return sharedTools.find((tool) => tool.name === name); }
export function getSharedToolNames() { return sharedTools.map((tool) => tool.name); }

export async function executeSharedTool(name: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  const tool = getSharedTool(name);
  if (!tool) return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  if (context.signal?.aborted) return { content: [{ type: 'text', text: 'Operation was cancelled' }], isError: true };
  const parsed = tool.inputSchema.safeParse(args);
  if (!parsed.success) {
    const text = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    return { content: [{ type: 'text', text: `Invalid input: ${text}` }], isError: true };
  }
  try {
    const result = await tool.handler(parsed.data as Record<string, unknown>, context);
    if (tool.outputSchema && !result.isError && !result.structuredContent) return { content: [{ type: 'text', text: 'Missing structuredContent' }], isError: true };
    return result;
  } catch (error) {
    return { content: [{ type: 'text', text: `Tool error: ${(error as Error).message}` }], isError: true };
  }
}
