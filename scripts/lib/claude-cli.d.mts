export const SHOP_FETCH: string[];
export function claudeArgs(opts?: { web?: boolean; maxTurns?: number }): string[];
export function resultText(stdout: string): string;
export function runClaude(prompt: string, opts?: { web?: boolean; maxTurns?: number; timeoutMs?: number; bin?: string; signal?: AbortSignal }): Promise<string>;
export function claudeAvailable(bin?: string): Promise<boolean>;
