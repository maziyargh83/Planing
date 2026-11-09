import { green } from "~/theme/colors/green";
import { red } from "~/theme/colors/red";
import { sand } from "~/theme/colors/sand";
import { amber } from "~/theme/colors/amber";
import { animationStyles } from "~/theme/animation-styles";
import { zIndex } from "~/theme/tokens/z-index";
import { shadows } from "~/theme/tokens/shadows";
import { durations } from "~/theme/tokens/durations";
import { colors } from "~/theme/tokens/colors";
import { textStyles } from "~/theme/text-styles";
import { layerStyles } from "~/theme/layer-styles";
import { keyframes } from "~/theme/keyframes";
import { globalCss } from "~/theme/global-css";
import { conditions } from "~/theme/conditions";
import { slotRecipes, recipes } from "~/theme/recipes";
import { defineConfig } from "@pandacss/dev";

export default defineConfig({
    preflight: true,
    jsxFramework: "solid",
    include: ["./web/src/**/*.{ts,tsx}"],
    exclude: [],
    outdir: "web/styled-system",
    // Park components are used through wrappers Panda can't trace, so emit every recipe variant.
    staticCss: { recipes: "*" },

    theme: {
		extend: {
            tokens: {
                fonts: {
					body: { value: '"Vazirmatn Variable", system-ui, sans-serif' },
					heading: { value: '"Vazirmatn Variable", system-ui, sans-serif' },
					mono: { value: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
				},

                colors: colors,
                durations: durations,
                zIndex: zIndex
            },

            animationStyles: animationStyles,
            recipes: recipes,
            slotRecipes: slotRecipes,
            keyframes: keyframes,
            layerStyles: layerStyles,
            textStyles: textStyles,

            semanticTokens: {
                colors: {
                    fg: {
                        default: {
                            value: {
                                _light: "{colors.gray.12}",
                                _dark: "{colors.gray.12}"
                            }
                        },

                        muted: {
                            value: {
                                _light: "{colors.gray.11}",
                                _dark: "{colors.gray.11}"
                            }
                        },

                        subtle: {
                            value: {
                                _light: "{colors.gray.10}",
                                _dark: "{colors.gray.10}"
                            }
                        }
                    },

                    border: {
                        value: {
                            _light: "{colors.gray.4}",
                            _dark: "{colors.gray.4}"
                        }
                    },

                    error: {
                        value: {
                            _light: "{colors.red.9}",
                            _dark: "{colors.red.9}"
                        }
                    },

                    amber: amber,
                    gray: sand,
                    red: red,
                    green: green
                },

                shadows: shadows
            }
        },
	},

    globalCss: globalCss,
    conditions: conditions
});