import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { openDb } from "../../storage/db.ts";
import { createMcpServer } from "./server.ts";

const server = createMcpServer(openDb(), process.env.GAAM_ACTOR);
await server.connect(new StdioServerTransport());
