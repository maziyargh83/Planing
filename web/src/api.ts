import { QueryClient } from "@tanstack/solid-query";
import { createSignal, startTransition } from "solid-js";

import { toaster } from "~/components/ui/toast";

import type { GaamEvent } from "../../src/core/types.ts";

export type * from "../../src/core/types.ts";

export class ApiError extends Error {
	code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code = code;
	}
}

// ── Workspace ──────────────────────────────────────────────────────────────

const WS_KEY = "gaam.workspace";
function readWorkspace(): string {
	try {
		return localStorage.getItem(WS_KEY) ?? "all";
	} catch {
		return "all";
	}
}
const [workspace, setWorkspaceSignal] = createSignal(readWorkspace());
export { workspace };
/** Switches the whole UI to a workspace key, or "all". Every resource refetches. */
export function setWorkspace(key: string) {
	setWorkspaceSignal(key);
	try {
		localStorage.setItem(WS_KEY, key);
	} catch {}
	bump();
}
/** Headers that scope a request to the active workspace. */
export function wsHeaders(extra: Record<string, string> = {}): Record<string, string> {
	return workspace() === "all" ? extra : { ...extra, "x-gaam-workspace": workspace() };
}

/** Calls a Planner method on the server. Names match src/core/planner.ts one to one. */
export async function rpc<T = any>(method: string, ...args: unknown[]): Promise<T> {
	const res = await fetch("/api/rpc", {
		method: "POST",
		headers: wsHeaders({ "Content-Type": "application/json" }),
		body: JSON.stringify({ method, args }),
	});
	const body = await res.json();
	if (body.error) {
		toast(body.error.message, "error");
		throw new ApiError(body.error.code, body.error.message);
	}
	return body.data as T;
}

// ── Live updates ───────────────────────────────────────────────────────────

/** Bumps on every change anywhere (UI, HTTP MCP, stdio MCP). Resources use it as their source. */
const [version, setVersion] = createSignal(0);
const [feed, setFeed] = createSignal<GaamEvent[]>([]);
const [online, setOnline] = createSignal(false);
export { feed, online, version };

/** Data cache for TanStack Query. The live event stream invalidates it, like the version signal. */
export const queryClient = new QueryClient({
	defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
});

/**
 * Refreshes everything. It runs as a transition so Suspense keeps showing the
 * current UI while data reloads; otherwise the router's boundary unmounts the
 * whole app on every save (scroll resets, drawers re-animate, typing is lost).
 */
export function bump() {
	void startTransition(() => {
		setVersion((v) => v + 1);
		void queryClient.invalidateQueries();
	});
}

export function connectStream() {
	const source = new EventSource("/api/stream");
	let timer: number | undefined;
	source.onopen = () => setOnline(true);
	source.onerror = () => setOnline(false);
	source.addEventListener("change", (e) => {
		const event = JSON.parse((e as MessageEvent).data) as GaamEvent;
		setFeed((f) => [event, ...f].slice(0, 80));
		if (event.actor !== "me") toast(`${event.actor}: ${event.summary ?? event.action}`, "agent");
		clearTimeout(timer);
		timer = window.setTimeout(bump, 120);
	});
	rpc<GaamEvent[]>("events", 0, 40).then((events) => setFeed(events.reverse()));
}

// ── Toasts ─────────────────────────────────────────────────────────────────

export interface Toast {
	id: number;
	text: string;
	kind: "info" | "error" | "agent" | "win";
}
let toastId = 0;
export function toast(text: string, kind: Toast["kind"] = "info") {
	toastId++;
	toaster.create({
		title: kind === "agent" ? `🤖 ${text.split(":")[0]}` : text,
		description: kind === "agent" ? text.split(":").slice(1).join(":").trim() : undefined,
		type: kind === "error" ? "error" : kind === "win" ? "success" : "info",
		duration: kind === "error" ? 6000 : 3500,
		closable: kind === "error",
	});
}

// ── Formatting ─────────────────────────────────────────────────────────────

const faNumber = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 });
export const fa = (n: number | null | undefined) => (n == null ? "—" : faNumber.format(n));

export const jalali = (date: Date | string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" }) =>
	new Intl.DateTimeFormat("fa-IR-u-ca-persian", opts).format(typeof date === "string" ? new Date(date.length === 10 ? `${date}T12:00:00` : date) : date);

export function ago(iso: string) {
	const s = (Date.now() - Date.parse(iso)) / 1000;
	if (s < 60) return "همین الان";
	if (s < 3600) return `${fa(Math.floor(s / 60))} دقیقه پیش`;
	if (s < 86400) return `${fa(Math.floor(s / 3600))} ساعت پیش`;
	return `${fa(Math.floor(s / 86400))} روز پیش`;
}

export const today = () => new Date().toLocaleDateString("en-CA");

export const STAGES = ["idea", "discovery", "scoping", "ready", "active", "shipped", "archived"] as const;
export const STAGE_FA: Record<string, string> = {
	idea: "ایده",
	discovery: "دیسکاوری",
	scoping: "اسکوپ",
	ready: "آماده",
	active: "در جریان",
	shipped: "تحویل شد",
	archived: "بایگانی",
};
export const STATUSES = ["inbox", "todo", "doing", "blocked", "done", "dropped"] as const;
export const STATUS_FA: Record<string, string> = {
	inbox: "صندوق",
	todo: "بعدی",
	doing: "در حال انجام",
	blocked: "گیر کرده",
	done: "انجام شد",
	dropped: "کنار گذاشته",
};
export const SCOPE_FA: Record<string, string> = { in: "داخل اسکوپ", later: "بعداً", out: "خارج از اسکوپ" };
export const KIND_FA: Record<string, string> = {
	idea: "ایده",
	question: "سؤال",
	risk: "ریسک",
	decision: "تصمیم",
	insight: "بینش",
	data: "داده",
	option: "گزینه",
	goal: "هدف",
};
export const KIND_ICON: Record<string, string> = {
	idea: "💡",
	question: "❓",
	risk: "⚠️",
	decision: "✅",
	insight: "🔎",
	data: "📊",
	option: "🔀",
	goal: "🎯",
};
export const TOPIC_FA: Record<string, string> = {
	preference: "ترجیح‌ها",
	pattern: "الگوها",
	context: "زمینه",
	value: "ارزش‌ها",
	skill: "مهارت‌ها",
	constraint: "محدودیت‌ها",
	goal: "هدف‌ها",
};
export const HORIZON_FA: Record<string, string> = { week: "هفته", month: "ماه", quarter: "فصل", year: "سال", life: "زندگی" };
export const PRIORITY_FA = ["P0", "P1", "P2", "P3"];
