import { RecallPage, RecallSourcePage } from "./pages/Recall.tsx";
import { createHashHistory, createRootRoute, createRoute, createRouter, redirect, useParams } from "@tanstack/solid-router";

import { AssistantPage, AutomationsPage } from "./pages/Assistant.tsx";
import { GrowthPage, PeoplePage } from "./pages/Growth.tsx";
import { KnowledgePage } from "./pages/Knowledge.tsx";
import { NowPage } from "./pages/Now.tsx";
import { Connect, Goals, Inbox, InsightsPage, MemoryPage } from "./pages/Pages.tsx";
import { ProjectPage, Projects } from "./pages/Projects.tsx";
import { SkyPage } from "./pages/Sky.tsx";
import { Today } from "./pages/Today.tsx";
import { OverviewPage, TasksPage } from "./pages/Workspaces.tsx";
import { Shell } from "./shell.tsx";
import { setNavigator, setRoute } from "./ui.tsx";

const root = createRootRoute({ component: Shell, notFoundComponent: () => <NowPage /> });

const page = (path: string, component: (props: never) => unknown) => createRoute({ getParentRoute: () => root, path, component: component as never });

function ProjectRoute() {
	const params = useParams({ strict: false });
	return <ProjectPage projectKey={(params() as { key: string }).key} />;
}

const routeTree = root.addChildren([
	createRoute({
		getParentRoute: () => root,
		path: "/",
		beforeLoad: () => {
			throw redirect({ to: "/now" });
		},
	}),
	page("/now", NowPage),
	page("/recall", RecallPage),
	page("/sources/$id", RecallSourcePage),
	page("/sky", SkyPage),
	page("/today", Today),
	page("/tasks", TasksPage),
	page("/overview", OverviewPage),
	page("/assistant", AssistantPage),
	page("/assistant/$id", AssistantPage),
	page("/inbox", Inbox),
	page("/projects", Projects),
	createRoute({ getParentRoute: () => root, path: "/p/$key", component: ProjectRoute }),
	page("/goals", Goals),
	page("/growth", GrowthPage),
	page("/people", PeoplePage),
	page("/knowledge", KnowledgePage),
	page("/insights", InsightsPage),
	page("/memory", MemoryPage),
	page("/automations", AutomationsPage),
	page("/connect", Connect),
]);

export const router = createRouter({ routeTree, history: createHashHistory(), defaultPreload: "intent" });

setNavigator((path) => void router.navigate({ to: path as never }));
router.subscribe("onResolved", ({ toLocation }) => setRoute(toLocation.pathname));
