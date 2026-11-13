export const uiThemes = ["sage", "ocean", "playful-care", "honey-cocoa", "future-clinic"] as const;
export type UiTheme = (typeof uiThemes)[number];

export function getUiTheme(source: Record<string, string | undefined> = process.env): UiTheme {
  const configuredTheme = source.UI_THEME;
  return uiThemes.includes(configuredTheme as UiTheme) ? configuredTheme as UiTheme : "sage";
}
