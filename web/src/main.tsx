import "./index.css";
import "./styles.css";
import "./theme-mode.ts";

import { QueryClientProvider } from "@tanstack/solid-query";
import { RouterProvider } from "@tanstack/solid-router";
import { render } from "solid-js/web";

import { queryClient } from "./api.ts";
import { AppProviders } from "./kit.tsx";
import { router } from "./router.tsx";

render(
	() => (
		<QueryClientProvider client={queryClient}>
			<AppProviders>
				<RouterProvider router={router} />
			</AppProviders>
		</QueryClientProvider>
	),
	document.getElementById("root")!,
);
