import { DateField, Field as FormField, HoursField, PersonField, Pills } from "~/components/form.tsx";
import { Choice } from "~/components/app.tsx";
import { LocaleProvider } from "@ark-ui/solid/locale";
import { createSignal, For, type JSX, Match, Show, Switch } from "solid-js";
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
	type?: "text" | "textarea" | "date" | "number" | "select" | "pills" | "person" | "hours";
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
const [errors, setErrors] = createStore<Record<string, string>>({});

/** A real dialog instead of window.prompt: resolves with the values, or null when cancelled. */
export function ask(opts: Omit<DialogRequest, "resolve" | "confirm"> & { confirm?: string }): Promise<Record<string, string> | null> {
	return new Promise((resolve) => {
		setValues(Object.fromEntries(opts.fields.map((f) => [f.name, f.value ?? ""])));
		setErrors({});
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
		const missing = r.fields.filter((f) => f.required && !values[f.name]?.trim());
		if (missing.length) {
			setErrors(Object.fromEntries(missing.map((f) => [f.name, "این فیلد را کامل کن."])));
			requestAnimationFrame(() => document.getElementById(`ask-field-${missing[0]!.name}`)?.querySelector<HTMLElement>("input, textarea, button")?.focus());
			return;
		}
		setErrors({});
		close({ ...values });
	};
	const setField = (name: string, value: string) => {
		setValues(name, value);
		if (errors[name]) setErrors(name, "");
	};
	return (
		<Dialog.Root open={Boolean(request())} onOpenChange={(e) => !e.open && close(null)} size="sm" lazyMount unmountOnExit>
			<Dialog.Backdrop />
			<Dialog.Positioner>
					<Dialog.Content class="guided-dialog">
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
										<FormField id={`ask-field-${f.name}`} label={f.label} hint={f.hint} error={errors[f.name]} required={f.required} class="dlg-field">
											<Switch
												fallback={
													<Input
														autofocus={i() === 0}
														aria-invalid={Boolean(errors[f.name])}
														type={f.type === "number" ? "number" : "text"}
														dir={f.type === "number" ? "ltr" : undefined}
														placeholder={f.placeholder}
														value={values[f.name] ?? ""}
														onInput={(e) => setField(f.name, e.currentTarget.value)}
													/>
												}
											>
												<Match when={f.type === "textarea"}>
													<Textarea autofocus={i() === 0} aria-invalid={Boolean(errors[f.name])} rows={4} placeholder={f.placeholder} value={values[f.name] ?? ""} onInput={(e) => setField(f.name, e.currentTarget.value)} />
												</Match>
												<Match when={f.type === "select"}>
													<Choice width="100%" value={values[f.name]} options={f.options ?? []} onChange={(v) => setField(f.name, v)} />
												</Match>
												<Match when={f.type === "pills"}>
													<Pills label={f.label} invalid={Boolean(errors[f.name])} value={values[f.name]} options={(f.options ?? []).map((o) => ({ value: o.value, label: o.label }))} onChange={(v) => setField(f.name, v)} />
												</Match>
												<Match when={f.type === "date"}>
													<DateField invalid={Boolean(errors[f.name])} value={values[f.name] || null} onChange={(v) => setField(f.name, v ?? "")} />
												</Match>
												<Match when={f.type === "person"}>
													<PersonField invalid={Boolean(errors[f.name])} value={values[f.name] || null} onChange={(v) => setField(f.name, v ?? "")} />
												</Match>
												<Match when={f.type === "hours"}>
													<HoursField value={values[f.name] ? Number(values[f.name]) : null} onChange={(v) => setField(f.name, v == null ? "" : String(v))} />
												</Match>
											</Switch>
											<Show when={f.suggestions?.length}>
												<div class="pills sm">
													<For each={f.suggestions}>
														{(s) => (
															<button type="button" class="pill" classList={{ on: values[f.name] === s.value }} onClick={() => setField(f.name, s.value)}>
																{s.label}
															</button>
														)}
													</For>
												</div>
											</Show>
										</FormField>
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
