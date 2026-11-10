import { NavigationDock } from "./components/NavigationDock.tsx";
import { Outlet } from "@tanstack/solid-router";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-solid";
import { createMemo, createSignal, For, onCleanup, onMount, Show, Suspense } from "solid-js";
import { createResource } from "./live.ts";

import * as Drawer from "~/components/ui/drawer";
import * as SegmentGroup from "~/components/ui/segment-group";
import { ago, connectStream, fa, feed, online, rpc, version } from "./api.ts";
import { Palette, openPalette } from "./palette.tsx";
import { AssistantPage } from "./pages/Chat.tsx";
import { WorkspaceSwitcher } from "./pages/Workspaces.tsx";
import { mode, setMode, type ThemeMode } from "./theme-mode.ts";
import { go, route, TaskDrawer } from "./ui.tsx";

export function ThemeSwitch() {
	return (
		<SegmentGroup.Root size="xs" value={mode()} onValueChange={(e) => e.value && setMode(e.value as ThemeMode)} aria-label="تم">
			<SegmentGroup.Indicator />
			<SegmentGroup.Items
				items={[
					{ value: "light", label: <SunIcon size={14} /> },
					{ value: "system", label: <MonitorIcon size={14} /> },
					{ value: "dark", label: <MoonIcon size={14} /> },
				]}
			/>
		</SegmentGroup.Root>
	);
}

/** Morning, day, dusk or night: the whole stage is tinted by the hour. */
function phase() {
	const h = new Date().getHours();
	if (h >= 5 && h < 9) return "dawn";
	if (h >= 9 && h < 16) return "day";
	if (h >= 16 && h < 20) return "dusk";
	return "night";
}

interface Nudge {
	code: string;
	level: string;
	message: string;
	refs?: string[];
}

/** The companion: an orb that speaks the coach's nudges and opens a chat over the current page. */
function Companion() {
	const [open, setOpen] = createSignal(false);
	const [dismissed, setDismissed] = createSignal<string[]>([]);
	const [ctx] = createResource(version, () => rpc<{ nudges: Nudge[] }>("context").catch(() => null));
	const bubble = createMemo(() => (ctx()?.nudges ?? []).find((n) => n.level !== "win" && !dismissed().includes(n.code)));
	const onKey = (e: KeyboardEvent) => {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
			e.preventDefault();
			setOpen((o) => !o);
		}
	};
	onMount(() => window.addEventListener("keydown", onKey));
	onCleanup(() => window.removeEventListener("keydown", onKey));
	return (
		<>
			<Show when={bubble() && !open() && !route().startsWith("/assistant")}>
				<div class="orb-bubble" onClick={() => setOpen(true)}>
					<button
						type="button"
						class="orb-bubble-x"
						onClick={(e) => {
							e.stopPropagation();
							setDismissed((d) => [...d, bubble()!.code]);
						}}
					>
						×
					</button>
					{bubble()!.message}
				</div>
			</Show>
			<Show when={!route().startsWith("/assistant")}>
				<button type="button" class="orb" classList={{ talking: Boolean(bubble()) }} title="همراه (⌘J)" onClick={() => setOpen(!open())}>
					<span class="orb-core" />
				</button>
			</Show>
			<Drawer.Root open={open()} onOpenChange={(e) => setOpen(e.open)} placement="start" size="md">
				<Drawer.Backdrop />
				<Drawer.Positioner>
					<Drawer.Content class="companion-sheet">
						{/* Loading data here must not suspend the router's root boundary: that tears down the dialog's open-state effects (Esc, outside click, focus). */}
						<Suspense>
							<Show when={open()}>
								<AssistantPage compact initialContext={[{ type: "page", route: route(), label: "همین صفحه" }]} />
							</Show>
						</Suspense>
					</Drawer.Content>
				</Drawer.Positioner>
			</Drawer.Root>
		</>
	);
}

function ActivityButton() {
	const [open, setOpen] = createSignal(false);
	return (
		<div class="activity">
			<button type="button" class="topbtn" classList={{ live: online() }} title="فعالیت زنده" onClick={() => setOpen(!open())}>
				<i class="live-dot" /> {fa(feed().length)}
			</button>
			<Show when={open()}>
				<div class="activity-pop" onMouseLeave={() => setOpen(false)}>
					<For each={feed().slice(0, 30)} fallback={<div class="faint small">هنوز خبری نیست.</div>}>
						{(e) => (
							<div class="feed-item">
								<span class="feed-dot" classList={{ agent: e.actor !== "me" }} />
								<div>
									<b>{e.actor === "me" ? "من" : e.actor}</b> {e.summary ?? e.action}
									<div class="faint">{ago(e.at)}</div>
								</div>
							</div>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}

export function Shell() {
	onMount(connectStream);
	const [tint, setTint] = createSignal(phase());
	const t = setInterval(() => setTint(phase()), 5 * 60e3);
	onCleanup(() => clearInterval(t));
	return (
		<div class={`app2 phase-${tint()}`}>
			<div class="ambient" aria-hidden="true">
				<i class="glow a" />
				<i class="glow b" />
			</div>
			<a class="skip-main" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById("main-content")?.focus(); }}>رفتن به محتوای صفحه</a>
			<header class="topbar">
				<button type="button" class="brand2" onClick={() => go("/now")}>
					<span class="brand-mark">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
							<path d="M4 17l5-5 4 4 7-9" />
						</svg>
					</span>
					گام
				</button>
				<Suspense>
					<WorkspaceSwitcher />
				</Suspense>
				<button type="button" class="capture2" onClick={() => openPalette()}>
					<span>＋ یک فکر، یک کار، یک قرار…</span>
					<kbd>⌘K</kbd>
				</button>
				<span class="spacer" />
				<ActivityButton />
				<ThemeSwitch />
			</header>
			{/* Each page loads inside its own boundary, so the shell and its drawers never unmount. */}
			<main class="stage" id="main-content" tabindex="-1">
				<Suspense>
					<Outlet />
				</Suspense>
			</main>
			<NavigationDock />
			<Suspense>
				<Companion />
			</Suspense>
			<Suspense>
				<TaskDrawer />
			</Suspense>
			<Suspense>
				<Palette />
			</Suspense>
		</div>
	);
}
