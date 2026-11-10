import { useQuery } from "@tanstack/solid-query";
import { createMemo, createSignal, For, Show } from "solid-js";

import { fa, rpc, workspace } from "../api.ts";
import { go } from "../ui.tsx";

interface GoalRow {
	id: number;
	title: string;
	status: string;
	workspace_id: number | null;
	current: number | null;
	target: number | null;
	evidence: number;
	kind: string | null;
}
interface ProjectRow {
	id: number;
	key: string;
	title: string;
	stage: string;
	goal_id: number | null;
	workspace_id: number | null;
	tasks: number;
	done: number;
	doing: number;
}
interface WorkspaceRow {
	id: number;
	name: string;
	icon: string | null;
	color: string | null;
}

// Phones get a portrait canvas so labels stay readable instead of shrinking with a wide one.
const portrait = typeof matchMedia !== "undefined" && matchMedia("(max-width: 640px)").matches;
const W = portrait ? 520 : 1000;
const H = portrait ? 860 : 720;
const CX = W / 2;
const CY = H / 2;
const PALETTE = ["#f5a524", "#3ecf8e", "#a78bfa", "#5aa9ff", "#f472b6", "#22d3ee"];
const goalName = (t: string) => (t.includes(" · ") ? t.split(" · ").at(-1)! : t);

/** Deterministic pseudo-random so the background sky doesn't jump on every render. */
function seeded(n: number) {
	let x = Math.sin(n * 9301 + 49297) * 233280;
	return x - Math.floor(x);
}

export function SkyPage() {
	const goals = useQuery(() => ({ queryKey: ["goals", workspace()], queryFn: () => rpc<GoalRow[]>("listGoals") }));
	const projects = useQuery(() => ({ queryKey: ["projects", workspace()], queryFn: () => rpc<ProjectRow[]>("listProjects") }));
	const spaces = useQuery(() => ({ queryKey: ["workspaces"], queryFn: () => rpc<WorkspaceRow[]>("workspaces") }));
	const [hover, setHover] = createSignal<string | null>(null);

	const color = (wsId: number | null) => {
		const list = spaces.data ?? [];
		const i = list.findIndex((w) => w.id === wsId);
		return list[i]?.color ?? PALETTE[Math.max(0, i) % PALETTE.length]!;
	};

	const layout = createMemo(() => {
		const gs = (goals.data ?? []).filter((g) => g.status === "active").slice(0, 12);
		const ps = projects.data ?? [];
		const rx = W * (portrait ? 0.34 : 0.259);
		const ry = H * (portrait ? 0.36 : 0.295);
		const stars = gs.map((g, i) => {
			const a = (i / Math.max(1, gs.length)) * Math.PI * 2 - Math.PI / 2;
			const progress = g.target ? Math.min(1, (g.current ?? 0) / g.target) : Math.min(1, g.evidence / 8);
			return { g, x: CX + Math.cos(a) * rx, y: CY + Math.sin(a) * ry, r: 10 + progress * 10, progress };
		});
		const orbiting = (goalId: number | null) => ps.filter((p) => p.goal_id === goalId);
		const planets = stars.flatMap((s) =>
			orbiting(s.g.id).map((p, j, all) => {
				const a = (j / all.length) * Math.PI * 2 + s.x / 100;
				const d = 58 + (j % 2) * 18;
				return { p, x: s.x + Math.cos(a) * d, y: s.y + Math.sin(a) * d, parent: s };
			}),
		);
		const loose = ps.filter((p) => p.goal_id == null || !stars.some((s) => s.g.id === p.goal_id));
		const drifting = loose.map((p, j) => {
			const a = (j / Math.max(1, loose.length)) * Math.PI * 2;
			return { p, x: CX + Math.cos(a) * 110, y: CY + Math.sin(a) * 90, parent: null };
		});
		return { stars, planets: [...planets, ...drifting], loose: loose.length };
	});

	const dust = Array.from({ length: portrait ? 60 : 90 }, (_, i) => ({ x: seeded(i) * W, y: seeded(i + 500) * H, r: seeded(i + 900) * 1.4 + 0.3, d: seeded(i + 1300) * 4 }));

	return (
		<div class="sky">
			<div class="sky-head">
				<h1>کهکشان</h1>
				<p class="muted">اهداف ستاره‌اند، پروژه‌ها دورشان می‌چرخند، و هر نقطه یک قدم باز است. هرچه ستاره روشن‌تر، به هدف نزدیک‌تر.</p>
			</div>
			<svg class="sky-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="نقشه‌ی اهداف و پروژه‌ها">
				<defs>
					<radialGradient id="you" cx="50%" cy="50%" r="50%">
						<stop offset="0" stop-color="#fff7e0" />
						<stop offset="0.45" stop-color="#f5a524" />
						<stop offset="1" stop-color="#f5a52400" />
					</radialGradient>
					<filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
						<feGaussianBlur stdDeviation="4" result="b" />
						<feMerge>
							<feMergeNode in="b" />
							<feMergeNode in="SourceGraphic" />
						</feMerge>
					</filter>
				</defs>
				<For each={dust}>{(s) => <circle cx={s.x} cy={s.y} r={s.r} class="dust" style={{ "animation-delay": `${s.d}s` }} />}</For>

				<For each={layout().stars}>{(s) => <line x1={CX} y1={CY} x2={s.x} y2={s.y} class="ray" />}</For>
				<For each={layout().planets}>{(pl) => <Show when={pl.parent}>{(par) => <line x1={par().x} y1={par().y} x2={pl.x} y2={pl.y} class="tether" />}</Show>}</For>

				<g class="you" onClick={() => go("/now")}>
					<circle cx={CX} cy={CY} r="46" fill="url(#you)" />
					<circle cx={CX} cy={CY} r="14" class="you-core" />
					<text x={CX} y={CY + 64} text-anchor="middle" class="sky-label strong">
						تو
					</text>
				</g>

				<For each={layout().stars}>
					{(s) => (
						<g class="star" onMouseEnter={() => setHover(`g${s.g.id}`)} onMouseLeave={() => setHover(null)} onClick={() => go("/goals")}>
							<title>{`${s.g.title}\nپیشرفت: ${Math.round(s.progress * 100)}٪ · شاهد: ${s.g.evidence}`}</title>
							<circle cx={s.x} cy={s.y} r={s.r + 14} fill={color(s.g.workspace_id)} opacity={0.08 + s.progress * 0.25} />
							<circle cx={s.x} cy={s.y} r={s.r} fill={color(s.g.workspace_id)} filter="url(#glow)" opacity={0.55 + s.progress * 0.45} />
							<text x={s.x} y={s.y + s.r + 18} text-anchor="middle" class="sky-label" classList={{ strong: hover() === `g${s.g.id}` }}>
								{goalName(s.g.title).slice(0, 30)}
							</text>
						</g>
					)}
				</For>

				<For each={layout().planets}>
					{(pl) => {
						const open = Math.max(0, pl.p.tasks - pl.p.done);
						const dots = Math.min(open, 14);
						return (
							<g class="planet" onMouseEnter={() => setHover(pl.p.key)} onMouseLeave={() => setHover(null)} onClick={() => go(`/p/${pl.p.key}`)}>
								<title>{`${pl.p.key} · ${pl.p.title}\n${pl.p.done}/${pl.p.tasks} انجام شده · ${pl.p.doing} در جریان`}</title>
								<g class="orbit" style={{ "transform-origin": `${pl.x}px ${pl.y}px`, "animation-duration": `${40 + (pl.p.id % 5) * 12}s` }}>
									<For each={Array.from({ length: dots }, (_, i) => i)}>
										{(i) => {
											const a = (i / Math.max(1, dots)) * Math.PI * 2;
											return <circle cx={pl.x + Math.cos(a) * 22} cy={pl.y + Math.sin(a) * 22} r="2.4" class="moon" classList={{ doing: i < pl.p.doing }} />;
										}}
									</For>
								</g>
								<circle cx={pl.x} cy={pl.y} r={8 + Math.min(8, pl.p.tasks / 3)} fill={color(pl.p.workspace_id)} class="planet-body" />
								<text x={pl.x} y={pl.y - 30} text-anchor="middle" class="sky-label small" classList={{ strong: hover() === pl.p.key }}>
									{pl.p.key}
								</text>
							</g>
						);
					}}
				</For>
			</svg>
			<div class="sky-legend">
				<For each={spaces.data ?? []}>
					{(w, i) => (
						<span>
							<i style={{ background: w.color ?? PALETTE[i() % PALETTE.length] }} />
							{w.icon} {w.name}
						</span>
					)}
				</For>
				<span class="faint">
					{fa(layout().stars.length)} هدف · {fa(layout().planets.length)} پروژه
					<Show when={layout().loose}> · {fa(layout().loose)} پروژه‌ی بی‌هدف نزدیک تو</Show>
				</span>
			</div>
		</div>
	);
}
