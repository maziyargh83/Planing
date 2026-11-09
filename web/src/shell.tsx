import { MonitorIcon, MoonIcon, SunIcon } from "lucide-solid";

import * as SegmentGroup from "~/components/ui/segment-group";
import { mode, setMode, type ThemeMode } from "./theme-mode.ts";

export function ThemeSwitch() {
	return (
		<SegmentGroup.Root size="xs" value={mode()} onValueChange={(e) => e.value && setMode(e.value as ThemeMode)} aria-label="تم">
			<SegmentGroup.Indicator />
			<SegmentGroup.Items
				items={[
					{ value: "light", label: <SunIcon size={14} /> },
					{ value: "system", label: <MonitorIcon size={14} /> },
					{ value: "dark", label: <MoonIcon size={14} /> },
				]}
			/>
		</SegmentGroup.Root>
	);
}
