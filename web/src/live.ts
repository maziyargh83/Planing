/**
 * Solid's createResource, but each refetch is reconciled into a store (rows
 * matched by `id`). Unchanged rows keep their DOM, so a live update from the
 * event stream doesn't rebuild every card or wipe a field you're typing in.
 */
import { type Accessor, createResource as solidResource, type ResourceOptions, type Setter } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";

function reconciled<T>(init: T | undefined): [Accessor<T | undefined>, Setter<T | undefined>] {
	const [store, setStore] = createStore<{ v: T | undefined }>({ v: init });
	const set = ((next: unknown) => {
		const value = typeof next === "function" ? (next as (prev: T | undefined) => T)(unwrap(store.v)) : next;
		setStore("v", reconcile(value as T, { key: "id", merge: true }) as never);
		return store.v;
	}) as Setter<T | undefined>;
	return [() => store.v, set];
}

// The overloads mirror solid-js so call sites don't change.
export function createResource<T, R = unknown>(
	fetcher: (k: true, info: { value: T | undefined; refetching: R | boolean }) => T | Promise<T>,
	options?: ResourceOptions<T, true>,
): ReturnType<typeof solidResource<T, true, R>>;
export function createResource<T, S, R = unknown>(
	source: S | false | null | undefined | (() => S | false | null | undefined),
	fetcher: (k: S, info: { value: T | undefined; refetching: R | boolean }) => T | Promise<T>,
	options?: ResourceOptions<T, S>,
): ReturnType<typeof solidResource<T, S, R>>;
export function createResource(a: unknown, b?: unknown, c?: unknown) {
	if (typeof b === "function") return solidResource(a as never, b as never, { storage: reconciled, ...(c as object) } as never);
	return solidResource(a as never, { storage: reconciled, ...(b as object) } as never);
}
