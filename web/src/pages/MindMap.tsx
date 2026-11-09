import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { confirmAction } from "~/kit.tsx";

import { KIND_FA, KIND_ICON, type MindNode, rpc, toast } from "../api.ts";
import { openTask } from "../ui.tsx";

const W = 200;
const GAP_X = 70;
const ROW = 62;
const PAD = 40;

const KIND_COLOR: Record<string, string> = {
	idea: "var(--accent)",
	question: "var(--violet)",
	risk: "var(--red)",
	decision: "var(--green)",
	insight: "var(--cyan)",
	data: "var(--blue)",
	option: "var(--pink)",
	goal: "var(--accent)",
};

interface Placed {
	node: MindNode | null;
	depth: number;
	y: number;
	parent: Placed | null;
}

/** Tidy right-to-left tree: leaves take one row each, parents sit centred on their children. */
function layout(title: string, tree: MindNode[]) {
	const placed: Placed[] = [];
	let row = 0;
	let maxDepth = 0;
	const visit = (node: MindNode | null, children: MindNode[], depth: number, parent: Placed | null): Placed => {
		const self: Placed = { node, depth, y: 0, parent };
		maxDepth = Math.max(maxDepth, depth);
		const kids = children.map((c) => visit(c, c.children ?? [], depth + 1, self));
		self.y = kids.length ? (kids[0]!.y + kids[kids.length - 1]!.y) / 2 : row++ * ROW;
		placed.push(self);
		return self;
	};
	visit({ id: 0, text: title } as MindNode, tree, 0, null);
	const width = PAD * 2 + (maxDepth + 1) * W + maxDepth * GAP_X;
	const height = PAD * 2 + Math.max(1, row) * ROW;
	const left = (p: Placed) => width - PAD - W - p.depth * (W + GAP_X);
	const top = (p: Placed) => PAD + p.y;
	return { placed, width, height, left, top };
}

export function MindMap(props: { projectKey: string; title: string; tree: MindNode[] }) {
	const [selected, setSelected] = createSignal<number | null>(null);
	const [focusText, setFocusText] = createSignal(false);
	const geo = createMemo(() => layout(props.title, props.tree));
	const byId = createMemo(() => new Map(geo().placed.filter((p) => p.node!.id).map((p) => [p.node!.id, p.node!])));
	const sel = () => (selected() ? byId().get(selected()!) : undefined);
	let wrap!: HTMLDivElement;

	onMount(() => {
		wrap.scrollLeft = wrap.scrollWidth;
		let drag: { x: number; y: number; sl: number; st: number } | null = null;
		wrap.addEventListener("mousedown", (e) => {
			if ((e.target as HTMLElement).closest(".mm-node, .mm-panel")) return;
			drag = { x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
			wrap.style.cursor = "grabbing";
		});
		window.addEventListener("mousemove", (e) => {
			if (!drag) return;
			wrap.scrollLeft = drag.sl - (e.clientX - drag.x);
			wrap.scrollTop = drag.st - (e.clientY - drag.y);
		});
		window.addEventListener("mouseup", () => {
			drag = null;
			wrap.style.cursor = "";
		});
	});

	const addChild = async (parent: number | null) => {
		const [node] = await rpc<MindNode[]>("addNodes", props.projectKey, [{ text: "ایده جدید", kind: "idea" }], parent);
		setSelected(node!.id);
		setFocusText(true);
	};

	return (
		<div style={{ position: "relative" }}>
			<div class="row wrap" style={{ "margin-bottom": "10px" }}>
				<div class="mm-legend">
					<For each={Object.keys(KIND_FA)}>
						{(k) => (
							<span class="chip" style={{ color: KIND_COLOR[k] }}>
								{KIND_ICON[k]} {KIND_FA[k]}
							</span>
						)}
					</For>
				</div>
				<span class="spacer" />
				<span class="small faint">روی گره کلیک کن تا ویرایش شود · + برای شاخه جدید · پس‌زمینه را بکش</span>
			</div>
			<div class="mm-wrap" ref={wrap}>
				<div class="mm-canvas" style={{ width: `${geo().width}px`, height: `${geo().height}px` }}>
					<svg width={geo().width} height={geo().height}>
						<For each={geo().placed.filter((p) => p.parent)}>
							{(p) => {
								const x1 = geo().left(p.parent!);
								const y1 = geo().top(p.parent!) + 20;
								const x2 = geo().left(p) + W;
								const y2 = geo().top(p) + 20;
								const mx = (x1 + x2) / 2;
								return (
									<path
										d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
										fill="none"
										stroke={KIND_COLOR[p.node!.kind] ?? "var(--line-2)"}
										stroke-opacity="0.55"
										stroke-width="2"
									/>
								);
							}}
						</For>
					</svg>
					<For each={geo().placed}>
						{(p) => {
							const isRoot = !p.node!.id;
							return (
								<div
									class="mm-node"
									classList={{ root: isRoot, sel: selected() === p.node!.id }}
									style={{
										left: `${geo().left(p)}px`,
										top: `${geo().top(p)}px`,
										"--k": KIND_COLOR[p.node!.kind],
										"animation-delay": `${p.depth * 40}ms`,
									}}
									onClick={() => !isRoot && (setSelected(p.node!.id), setFocusText(false))}
									title={p.node!.note ?? p.node!.text}
								>
									<Show when={!isRoot}>
										<span>{KIND_ICON[p.node!.kind]}</span>
									</Show>
									<span class="txt">{p.node!.text}</span>
									<Show when={p.node!.task_id}>
										<span class="linked chip accent">تسک</span>
									</Show>
									<button
										class="plus"
										title="شاخه جدید"
										onClick={(e) => {
											e.stopPropagation();
											addChild(isRoot ? null : p.node!.id);
										}}
									>
										+
									</button>
								</div>
							);
						}}
					</For>
				</div>
			</div>

			<Show when={sel()}>
				{(node) => (
					<div class="card mm-panel" style={{ position: "absolute", top: "52px", left: "12px", width: "320px", "box-shadow": "var(--shadow)", "z-index": 5 }}>
						<div class="row" style={{ "margin-bottom": "8px" }}>
							<span class="chip faint">#{node().id}</span>
							<span class="spacer" />
							<button class="btn ghost sm" onClick={() => setSelected(null)}>
								✕
							</button>
						</div>
						<textarea
							class="textarea"
							rows="2"
							value={node().text}
							ref={(el) => focusText() && queueMicrotask(() => (el.focus(), el.select()))}
							onChange={(e) => rpc("updateNode", node().id, { text: e.currentTarget.value })}
						/>
						<div class="row wrap" style={{ margin: "8px 0", gap: "4px" }}>
							<For each={Object.keys(KIND_FA)}>
								{(k) => (
									<button
										class="btn sm"
										style={{ "border-color": node().kind === k ? KIND_COLOR[k] : undefined, color: node().kind === k ? KIND_COLOR[k] : undefined }}
										onClick={() => rpc("updateNode", node().id, { kind: k })}
									>
										{KIND_ICON[k]} {KIND_FA[k]}
									</button>
								)}
							</For>
						</div>
						<textarea
							class="textarea"
							rows="2"
							placeholder="یادداشت، منبع، عدد…"
							value={node().note ?? ""}
							onChange={(e) => rpc("updateNode", node().id, { note: e.currentTarget.value || null })}
						/>
						<div class="row wrap" style={{ "margin-top": "10px" }}>
							<button class="btn sm" onClick={() => addChild(node().id)}>
								+ شاخه
							</button>
							<Show
								when={node().task_id}
								fallback={
									<button class="btn sm" onClick={() => rpc("nodeToTask", node().id).then((t) => toast(`تسک ${t.key} ساخته شد`, "win"))}>
										→ تبدیل به تسک
									</button>
								}
							>
								<button class="btn sm" onClick={() => openTask(String(node().task_id))}>
									باز کردن تسک
								</button>
							</Show>
							<span class="spacer" />
							<button
								class="btn ghost danger sm"
								onClick={async () => (await confirmAction("این گره و شاخه‌هایش حذف شوند؟")) && rpc("deleteNode", node().id).then(() => setSelected(null))}
							>
								حذف
							</button>
						</div>
					</div>
				)}
			</Show>
		</div>
	);
}
