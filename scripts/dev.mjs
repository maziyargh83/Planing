import { spawn } from "node:child_process";

const run = (cmd, args) => spawn(cmd, args, { stdio: "inherit", shell: false });
const children = [
	run("node", ["--disable-warning=ExperimentalWarning", "--env-file-if-exists=.env", "--watch", "src/transports/http/main.ts"]),
	run("pnpm", ["exec", "vite"]),
];
const stop = () => children.forEach((c) => c.kill());
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
