/**
 * App-level building blocks on top of Park UI. Pages use these instead of raw
 * HTML so every button, card, tag, field and select shares one recipe.
 */
import { createListCollection } from "@ark-ui/solid/select";
import { createMemo, For, type JSX, splitProps } from "solid-js";
import { Portal } from "solid-js/web";

import { Badge, type BadgeProps } from "~/components/ui/badge";
import { Button, type ButtonProps } from "~/components/ui/button";
import * as Card from "~/components/ui/card";
import { Input, type InputProps } from "~/components/ui/input";
import * as Select from "~/components/ui/select";
import { Textarea, type TextareaProps } from "~/components/ui/textarea";

type Tone = "primary" | "ghost" | "default";

function parseKind(kind = "") {
	const words = new Set(kind.split(/\s+/).filter(Boolean));
	const tone: Tone = words.has("primary") ? "primary" : words.has("ghost") ? "ghost" : "default";
	return { tone, small: words.has("sm"), danger: words.has("danger") };
}

export interface BtnProps extends Omit<ButtonProps, "variant" | "size"> {
	/** Space-separated: primary | ghost, sm, danger. */
	kind?: string;
	/** Toggle state for pill groups: renders as primary when true. */
	active?: boolean;
}

export function Btn(props: BtnProps) {
	const [local, rest] = splitProps(props, ["kind", "active"]);
	const k = createMemo(() => parseKind(local.kind));
	const tone = () => (local.active ? "primary" : k().tone);
	return (
		<Button
			variant={tone() === "primary" ? "solid" : tone() === "ghost" ? "plain" : "surface"}
			size={k().small ? "xs" : "sm"}
			colorPalette={k().danger ? "red" : tone() === "primary" ? "amber" : "gray"}
			{...rest}
		/>
	);
}

export function Panel(props: Card.RootProps) {
	const [local, rest] = splitProps(props, ["class"]);
	return <Card.Root variant="outline" class={`panel ${local.class ?? ""}`} {...rest} />;
}

const TAG_TONE: [RegExp, BadgeProps["colorPalette"], BadgeProps["variant"]][] = [
	[/\bkey\b/, "gray", "outline"],
	[/\baccent\b/, "amber", "subtle"],
	[/\bP0\b|\bst-blocked\b/, "red", "subtle"],
	[/\bP1\b/, "amber", "surface"],
	[/\bst-done\b/, "green", "subtle"],
];

export function Tag(props: BadgeProps & { class?: string }) {
	const [local, rest] = splitProps(props, ["class"]);
	const tone = () => TAG_TONE.find(([re]) => re.test(local.class ?? "")) ?? [null, "gray", "subtle"];
	return <Badge size="md" variant={tone()[2]} colorPalette={tone()[1]} class={`tag ${local.class ?? ""}`} {...rest} />;
}

export function TextInput(props: InputProps) {
	return <Input size="sm" {...props} />;
}

export function TextArea(props: TextareaProps) {
	return <Textarea size="sm" {...props} />;
}

export interface ChoiceOption {
	value: string;
	label: JSX.Element | string;
	disabled?: boolean;
}

/** A Park Select from a plain options list. Empty string is a valid value (e.g. "none"). */
export function Choice(props: {
	value: string | number | null | undefined;
	options: ChoiceOption[];
	onChange: (value: string) => void;
	placeholder?: string;
	size?: "xs" | "sm" | "md";
	width?: string;
	class?: string;
	label?: string;
}) {
	const EMPTY = "__empty__";
	const toKey = (v: string) => (v === "" ? EMPTY : v);
	const collection = createMemo(() =>
		createListCollection({
			items: props.options.map((o) => ({ ...o, value: toKey(o.value) })),
			itemToString: (item) => (typeof item.label === "string" ? item.label : String(item.value)),
		}),
	);
	const current = () => (props.value == null ? EMPTY : toKey(String(props.value)));
	return (
		<Select.Root
			collection={collection()}
			value={[current()]}
			onValueChange={(e) => {
				const v = e.value[0];
				if (v !== undefined) props.onChange(v === EMPTY ? "" : v);
			}}
			size={props.size ?? "sm"}
			positioning={{ sameWidth: false }}
			class={props.class}
			style={{ width: props.width ?? "fit-content", "min-width": props.width ? "0" : "120px" }}
			aria-label={props.label}
		>
			<Select.Control>
				<Select.Trigger>
					<Select.ValueText placeholder={props.placeholder ?? "انتخاب…"} />
					<Select.Indicator />
				</Select.Trigger>
			</Select.Control>
			<Portal>
				<Select.Positioner>
					<Select.Content>
						<Select.List>
							<For each={collection().items}>
								{(item) => (
									<Select.Item item={item}>
										<Select.ItemText>{item.label}</Select.ItemText>
										<Select.ItemIndicator />
									</Select.Item>
								)}
							</For>
						</Select.List>
					</Select.Content>
				</Select.Positioner>
			</Portal>
			<Select.HiddenSelect />
		</Select.Root>
	);
}
