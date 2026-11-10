import { Choice } from "~/components/app.tsx";
import { LocaleProvider } from "@ark-ui/solid/locale";
import { createSignal, For, type JSX, Show } from "solid-js";
import { createStore } from "solid-js/store";

import { Button } from "~/components/ui/button";
import { CloseButton } from "~/components/ui/close-button";
import * as Dialog from "~/components/ui/dialog";
import * as Field from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Toaster } from "~/components/ui/toast";

export interface DialogField {
	name: string;
	label: string;
	type?: "text" | "textarea" | "date" | "number" | "select";
	placeholder?: string;
	value?: string;
	hint?: string;
	required?: boolean;
	options?: { value: string; label: string }[];
	/** Quick-pick chips under the field, e.g. team members or "امروز / فردا". */
	suggestions?: { value: string; label: string }[];
}

interface DialogRequest {
	title: string;
	description?: string;
	fields: DialogField[];
	confirm: string;
	danger?: boolean;
	resolve: (values: Record<string, string> | null) => void;
}

const [request, setRequest] = createSignal<DialogRequest | null>(null);
const [values, setValues] = createStore<Record<string, string>>({});

/** A real dialog instead of window.prompt: resolves with the values, or null when cancelled. */
export function ask(opts: Omit<DialogRequest, "resolve" | "confirm"> & { confirm?: string }): Promise<Record<string, string> | null> {
	return new Promise((resolve) => {
		setValues(Object.fromEntries(opts.fields.map((f) => [f.name, f.value ?? ""])));
		setRequest({ ...opts, confirm: opts.confirm ?? "تأیید", resolve });
	});
}

/** A real dialog instead of window.confirm. */
export async function confirmAction(title: string, description?: string, confirm = "حذف"): Promise<boolean> {
	return (await ask({ title, description, fields: [], confirm, danger: true })) !== null;
}

export const todayIso = () => new Date().toLocaleDateString("en-CA");
export const tomorrowIso = () => new Date(Date.now() + 864e5).toLocaleDateString("en-CA");
export const DATE_SUGGESTIONS = () => [
	{ value: todayIso(), label: "امروز" },
	{ value: tomorrowIso(), label: "فردا" },
	{ value: new Date(Date.now() + 7 * 864e5).toLocaleDateString("en-CA"), label: "هفته‌ی بعد" },
];

function DialogHost() {
	const close = (result: Record<string, string> | null) => {
		const r = request();
		setRequest(null);
		r?.resolve(result);
	};
	const submit = (e?: Event) => {
		e?.preventDefault();
		const r = request();
		if (!r) return;
		if (r.fields.some((f) => f.required && !values[f.name]?.trim())) return;
		close({ ...values });
	};
	return (
		<Dialog.Root open={Boolean(request())} onOpenChange={(e) => !e.open && close(null)} size="sm" lazyMount unmountOnExit>
			<Dialog.Backdrop />
			<Dialog.Positioner>
				<Dialog.Content>
					<form onSubmit={submit}>
						<Dialog.Header>
							<Dialog.Title>{request()?.title}</Dialog.Title>
							<Show when={request()?.description}>
								<Dialog.Description>{request()!.description}</Dialog.Description>
							</Show>
						</Dialog.Header>
						<Show when={request()?.fields.length}>
							<Dialog.Body>
								<For each={request()?.fields}>
									{(f, i) => (
										<Field.Root required={f.required} style={{ "margin-bottom": "12px" }}>
											<Field.Label>{f.label}</Field.Label>
											<Show
												when={f.type === "textarea"}
												fallback={
													<Show
														when={f.type === "select"}
														fallback={
															<Input
																autofocus={i() === 0}
																type={f.type ?? "text"}
																dir={f.type === "date" || f.type === "number" ? "ltr" : undefined}
																placeholder={f.placeholder}
																value={values[f.name] ?? ""}
																onInput={(e) => setValues(f.name, e.currentTarget.value)}
															/>
														}
													>
														<Choice width="100%" value={values[f.name]} options={f.options ?? []} onChange={(v) => setValues(f.name, v)} />
													</Show>
												}
											>
												<Textarea autofocus={i() === 0} rows={4} placeholder={f.placeholder} value={values[f.name] ?? ""} onInput={(e) => setValues(f.name, e.currentTarget.value)} />
											</Show>
											<Show when={f.suggestions?.length}>
												<div class="row wrap" style={{ gap: "4px", "margin-top": "6px" }}>
													<For each={f.suggestions}>
														{(s) => (
															<button type="button" class="chip suggest" classList={{ on: values[f.name] === s.value }} onClick={() => setValues(f.name, s.value)}>
																{s.label}
															</button>
														)}
													</For>
												</div>
											</Show>
											<Show when={f.hint}>
												<Field.HelperText>{f.hint}</Field.HelperText>
											</Show>
										</Field.Root>
									)}
								</For>
							</Dialog.Body>
						</Show>
						<Dialog.Footer>
							<Button type="button" variant="outline" onClick={() => close(null)}>
								انصراف
							</Button>
							<Button type="submit" colorPalette={request()?.danger ? "red" : "amber"}>
								{request()?.confirm}
							</Button>
						</Dialog.Footer>
					</form>
					<Dialog.CloseTrigger>
						<CloseButton size="sm" />
					</Dialog.CloseTrigger>
				</Dialog.Content>
			</Dialog.Positioner>
		</Dialog.Root>
	);
}

/** RTL locale for every Ark component, plus the global toaster and dialog host. */
export function AppProviders(props: { children: JSX.Element }) {
	return (
		<LocaleProvider locale="fa-IR">
			{props.children}
			<DialogHost />
			<Toaster />
		</LocaleProvider>
	);
}
