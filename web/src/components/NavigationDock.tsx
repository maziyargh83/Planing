import { Link } from "@tanstack/solid-router";
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { CircleDot, ListTodo, Orbit, Sprout, Users, Menu } from "lucide-solid";
import { primaryPages, pageGroups } from "../navigation.ts";
import { route } from "../ui.tsx";

const icons = { "/now": CircleDot, "/tasks": ListTodo, "/sky": Orbit, "/growth": Sprout, "/people": Users };

export function NavigationDock() {
	const [open, setOpen] = createSignal(false);
	let nav!: HTMLElement;
	let trigger!: HTMLButtonElement;
	createEffect(() => { route(); setOpen(false); });
	const outside = (event: PointerEvent) => { if (!nav.contains(event.target as Node)) setOpen(false); };
	const escape = (event: KeyboardEvent) => {
		if (open() && event.key === "Escape") { setOpen(false); trigger.focus(); }
	};
	onMount(() => { document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape); });
	onCleanup(() => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); });
	return <nav ref={nav} class="dock" aria-label="ناوبری اصلی">
		<For each={primaryPages}>{([path, , label]) => {
			const Icon = icons[path];
			return <Link to={path} class="dock-item" classList={{ on: route() === path }}><Icon size={19} aria-hidden="true" /><span class="dock-label">{label}</span></Link>;
		}}</For>
		<button ref={trigger} type="button" class="dock-item" aria-expanded={open()} aria-controls="page-directory"
			classList={{ on: open() || !primaryPages.some(([path]) => path === route()) }} onClick={() => setOpen(!open())}>
			<Menu size={19} aria-hidden="true" /><span class="dock-label">بیشتر</span>
		</button>
		<Show when={open()}><div id="page-directory" class="dock-more page-directory">
			<For each={pageGroups}>{(group) => <section><h2>{group.title}</h2><div class="directory-links">
				<For each={group.pages}>{([path, icon, label]) => <Link to={path} class="dock-more-item" classList={{ selected: route() === path }} onClick={() => setOpen(false)}>
					<span aria-hidden="true">{icon}</span>{label}
				</Link>}</For>
			</div></section>}</For>
		</div></Show>
	</nav>;
}
