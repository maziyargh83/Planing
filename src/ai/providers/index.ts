import { anthropic } from "./anthropic.ts";
import { claudeCode, codex } from "./cli.ts";
import { ollama, startOllama } from "./ollama.ts";
import type { Provider } from "./shared.ts";

export { friendlyError } from "./shared.ts";
export type { ProviderStatus, RunContext } from "./shared.ts";
export { startOllama };

export const PROVIDERS: Record<string, Provider> = { anthropic, claude: claudeCode, codex, ollama };

export function providerStatus() {
	return Promise.all(Object.values(PROVIDERS).map((p) => p.status()));
}
