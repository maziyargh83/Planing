import { createSignal } from "solid-js";

export type ThemeMode = "system" | "light" | "dark";

const KEY = "gaam.theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");

function read(): ThemeMode {
	try {
		const v = localStorage.getItem(KEY);
		return v === "light" || v === "dark" ? v : "system";
	} catch {
		return "system";
	}
}

const [mode, setModeSignal] = createSignal<ThemeMode>(read());
export { mode };

function apply() {
	const dark = mode() === "dark" || (mode() === "system" && media.matches);
	document.documentElement.classList.toggle("dark", dark);
	document.documentElement.classList.toggle("light", !dark);
	document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function setMode(next: ThemeMode) {
	setModeSignal(next);
	try {
		localStorage.setItem(KEY, next);
	} catch {}
	apply();
}

media.addEventListener("change", apply);
apply();
