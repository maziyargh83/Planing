import "./index.css";
import "./styles.css";
import "./theme-mode.ts";

import { createResource, For, Match, onMount, Show, Switch } from "solid-js";
import { render } from "solid-js/web";

import { ago, connectStream, fa, feed, online, rpc, version } from "./api.ts";
import { AssistantPage, AutomationsPage } from "./pages/Assistant.tsx";
import { GrowthPage, PeoplePage } from "./pages/Growth.tsx";
import { KnowledgePage } from "./pages/Knowledge.tsx";
import { MemoryPage, Connect, Goals, Inbox, InsightsPage } from "./pages/Pages.tsx";
import { ProjectPage, Projects } from "./pages/Projects.tsx";
import { Today } from "./pages/Today.tsx";
import { AppProviders } from "./kit.tsx";
import { ThemeSwitch } from "./shell.tsx";
import { openPalette, Palette } from "./palette.tsx";
import { route, TaskDrawer } from "./ui.tsx";

const NAV = [
	["/today", "☀️", "امروز"],
	["/assistant", "✳️", "دستیار"],
	["/inbox", "📥", "صندوق"],
	["/projects", "🧩", "پروژه‌ها"],
	["/goals", "🎯", "اهداف"],
	["/growth", "🌱", "رشد"],
	["/people", "🤝", "آدم‌ها"],
	["/knowledge", "📚", "دانش"],
	["/insights", "📈", "بینش‌ها"],
	["/memory", "🧠", "حافظه"],
	["/automations", "⚙️", "اتوماسیون"],
	["/connect", "🔌", "اتصال"],
] as const;

function App() {
	onMount(connectStream);
	const [counts] = createResource(version, async () => {
		const [inbox, asks] = await Promise.all([
			rpc<unknown[]>("listTasks", { project: "inbox", status: ["inbox"] }),
			rpc<unknown[]>("listAsks", { status: "open" }),
		]);
		return { "/inbox": inbox.length, "/today": asks.length } as Record<string, number>;
	});
	const active = (path: string) =>
		route() === path || (path === "/projects" && route().startsWith("/p/")) || (path === "/assistant" && route().startsWith("/assistant"));

	return (
		<div class="shell">
			<aside class="side">
				<div class="brand">
					<div class="brand-mark">
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
							<path d="M4 17l5-5 4 4 7-9" />
						</svg>
					</div>
					<div>
						گام
						<br />
						<small>قدم‌به‌قدم با ایجنت‌هایت</small>
					</div>
				</div>
				<button class="capture-btn" onClick={() => openPalette()}>
					<span>＋ ثبت سریع یا جستجو</span>
					<span class="kbd">⌘K</span>
				</button>
				<nav class="nav">
					<For each={NAV}>
						{([path, icon, label]) => (
							<a href={`#${path}`} classList={{ on: active(path) }}>
								<span>{icon}</span>
								<span class="label">{label}</span>
								<Show when={counts()?.[path]}>
									<span class="count">{fa(counts()![path])}</span>
								</Show>
							</a>
						)}
					</For>
				</nav>
				<div class="side-foot">
					<ThemeSwitch />
					<div class="live" classList={{ on: online() }}>
						<i /> فعالیت زنده
					</div>
					<div class="feed">
						<For each={feed().slice(0, 25)}>
							{(e) => (
								<div class="feed-item" title={new Date(e.at).toLocaleString("fa-IR")}>
									<span class="feed-dot" classList={{ agent: e.actor !== "me" }} />
									<div>
										<b>{e.actor === "me" ? "من" : e.actor}</b> {e.summary ?? e.action}
										<div class="faint">{ago(e.at)}</div>
									</div>
								</div>
							)}
						</For>
					</div>
				</div>
			</aside>
			<main>
				<Switch fallback={<Today />}>
					<Match when={route().startsWith("/p/")}>
						<ProjectPage projectKey={route().slice(3)} />
					</Match>
					<Match when={route().startsWith("/assistant")}>
						<AssistantPage />
					</Match>
					<Match when={route() === "/growth"}>
						<GrowthPage />
					</Match>
					<Match when={route() === "/knowledge"}>
						<KnowledgePage />
					</Match>
					<Match when={route() === "/people"}>
						<PeoplePage />
					</Match>
					<Match when={route() === "/automations"}>
						<AutomationsPage />
					</Match>
					<Match when={route() === "/projects"}>
						<Projects />
					</Match>
					<Match when={route() === "/inbox"}>
						<Inbox />
					</Match>
					<Match when={route() === "/goals"}>
						<Goals />
					</Match>
					<Match when={route() === "/insights"}>
						<InsightsPage />
					</Match>
					<Match when={route() === "/memory"}>
						<MemoryPage />
					</Match>
					<Match when={route() === "/connect"}>
						<Connect />
					</Match>
				</Switch>
			</main>
			<TaskDrawer />
			<Palette />
		</div>
	);
}

render(
	() => (
		<AppProviders>
			<App />
		</AppProviders>
	),
	document.getElementById("root")!,
);
