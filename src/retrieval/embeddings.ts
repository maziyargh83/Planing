import { digest } from "./text.ts";

export interface Embeddings {
	key: string;
	embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}

export function ollamaEmbeddings(): Embeddings {
	const url = process.env.GAAM_EMBEDDINGS_URL ?? "http://127.0.0.1:11434";
	const model = process.env.GAAM_EMBEDDINGS_MODEL ?? "bge-m3";
	return {
		key: digest(`${url}|${model}|v1`).slice(0, 20),
		async embed(input, signal) {
			const res = await fetch(`${url.replace(/\/$/, "")}/api/embed`, {
				method: "POST", headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ model, input, truncate: false }),
				signal: AbortSignal.any([AbortSignal.timeout(12_000), ...(signal ? [signal] : [])]),
			});
			if (!res.ok) throw new Error(`Embedding service: HTTP ${res.status}. Install ${model} in Ollama.`);
			const { embeddings } = await res.json() as { embeddings: number[][] };
			if (!Array.isArray(embeddings) || embeddings.length !== input.length || !embeddings[0]?.length ||
				embeddings.some((v) => !Array.isArray(v) || v.length !== embeddings[0]!.length || v.some((n) => !Number.isFinite(n))))
				throw new Error("Embedding service returned invalid vectors");
			return embeddings;
		},
	};
}
