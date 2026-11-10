# Recall, memory and evidence in Gaam

Gaam now retrieves evidence automatically for assistant turns and exposes the same capability to external MCP agents. Open **از سابقه‌ام پیدا کن** under the shell's **بیشتر** menu (`#/recall`) to search, review proposed memories and continue preparation workflows.

## What runs locally

- SQLite is authoritative. A new forward-only migration adds derived source/chunk/embedding receipts, memory versions and proposals, durable workflows and local traces. Existing planner data is preserved.
- LanceDB is an embedded derived vector index. Its default directory is `<database-file>.vectors` beside the SQLite database. It can be deleted and rebuilt. Back up SQLite as before; no vector backup is necessary.
- Retrieval combines normalized Persian keyword matching (FTS5) and cosine vector search using reciprocal rank fusion. It filters the workspace before ranking and validates every vector against current SQLite content. Updates/deletes invalidate derived sources immediately; stale vector rows are removed during semantic searches. Global memories and journal entries intentionally remain global.
- Source chunking preserves paragraph/sentence boundaries, with overlap for long passages. Model/endpoint changes use a different vector table and embedding receipts. At most 64 pending chunks are embedded per pass, so large corpora require multiple passes via `recall_reindex` or the UI.
- Context selection prioritizes attachments, current goals/work, confirmed memories and relevant evidence. It has a conservative character-based token estimate; it is not an exact tokenizer. The user's request is preserved. Provider-native transcripts remain intact; fallback text history is limited to recent turns with an extractive recap.
- Sources appear as clickable internal links and a collapsible source list in chat. Old links show the current canonical source; deleted or moved sources report unavailable.

## Enable semantic retrieval

Use Node 24+ and install dependencies with `pnpm install`. LanceDB's prebuilt native package is required. Its optional transformer/sharp/ONNX build scripts are disabled because Gaam uses Ollama for embeddings.

Start Ollama and install the model:

```sh
ollama serve
# In another terminal:
ollama pull bge-m3
```

Default settings already target `http://127.0.0.1:11434` and `bge-m3`. Override `GAAM_EMBEDDINGS_URL` / `GAAM_EMBEDDINGS_MODEL` if needed. No model is downloaded by Gaam itself. BGE-M3 is a candidate, not a claim of proven Persian quality: run the semantic evaluation suite against it.

If the model is unavailable, chat and recall continue with keyword retrieval and an explicit diagnostic. Failed services have a short cooldown. `GAAM_SEMANTIC=0` explicitly disables semantic search. `recall_status` reports the model, pending chunks and warnings.

`GAAM_VECTOR_PATH` may override the vector directory. Use a different directory for each Gaam database; do not point scratch evaluations at a real index.

## Mem0 and Graphiti (optional service)

The sidecar is isolated under `services/memory`. It uses Mem0 for extraction, Graphiti for timestamped relationship episodes, Neo4j for the graph and Ollama for local model calls. The main Node app does not require Python, Docker, Neo4j or cloud credentials.

Set a token and a database password in your shell (choose your own values; never commit them), then run:

```sh
export GAAM_MEMORY_TOKEN='your-own-long-random-token'
export NEO4J_PASSWORD='your-own-database-password'
ollama pull qwen3:8b
ollama pull bge-m3
docker compose -f services/memory/compose.yaml up --build -d
```

In Gaam's `.env`, set matching values:

```dotenv
GAAM_MEMORY_URL=http://127.0.0.1:4780
GAAM_MEMORY_TOKEN=your-own-long-random-token
# Optional; off by default:
# GAAM_MEMORY_AUTO=1
```

The service binds port 4780 to loopback only and requires its bearer token. Neo4j has no published host ports. The default Docker configuration uses `host.docker.internal` for Ollama; Linux receives a host-gateway mapping. Model names and embedding dimensions must match (BGE-M3 defaults to 1024 dimensions). Graphiti expects structured model output; local model compatibility/quality must be checked on the deployment machine.

`memory_extract` sends user-provided text to Mem0, using transient storage that is removed after extraction. Every candidate is stored locally as a **pending proposal**, never automatically accepted. The review UI explicitly explains that accepted profile memories are global. Corrections preserve old/new fact, source, actor and validity windows; forgetting deletes local history too.

`graph_publish` explicitly exports one workspace source after approval. `graph_search` is scoped and only returns facts whose recorded episode still corresponds to a matching current local source. It is supplemental evidence, never a write authority. Exported graph episodes remain in the optional graph service after a local deletion (they are filtered out from Gaam retrieval); deleting the sidecar volumes removes that external copy. Do not export data you do not want retained there.

The optional service has a contract test in Node with simulated Mem0/Graphiti responses. Live model extraction and Neo4j deployment require the services above; the regular test suite does not pretend to validate them.

## Durable workflows

The three workflows (meeting preparation, weekly review, idea-to-plan) persist stages, evidence snapshots, a reviewable draft and step history. Collect evidence, have the assistant draft from it, review, then publish. Publication checks evidence hashes and citation membership, writes one local document and is idempotent. Pause/resume works across server restarts. Publishing does not create tasks or send anything externally.

## Traces and optional Langfuse

Every assistant turn records retrieval mode, selected source IDs, estimated context size, omitted sections, usage and finish status locally (`aiTraces` RPC). Set all three environment variables to enable Langfuse's ingestion API:

```dotenv
LANGFUSE_BASE_URL=https://your-langfuse-instance
LANGFUSE_PUBLIC_KEY=...
LANGFUSE_SECRET_KEY=...
```

Only execution metadata is exported; prompts, responses and source bodies are not. Failed export is recorded locally and cannot fail the chat. No hosted account is created automatically.

## Verification and evaluation

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm eval
pnpm eval:semantic
```

`pnpm eval` runs Promptfoo against synthetic, isolated SQLite fixtures. It checks Persian retrieval, valid source links and workspace leakage without model calls. `pnpm eval:semantic` additionally checks bilingual retrieval against a real running embedding model and fails explicitly if semantic retrieval falls back. Neither suite opens the real Gaam database. The semantic gate tests retrieval, not end-to-end generation quality or factuality; manually review source-grounded answers before choosing a model.

For isolated UI testing set `GAAM_DB` to a scratch path, a separate `GAAM_PORT`, and `GAAM_SCHEDULER=0`. Never seed the user's real database.
