/** Brand colours for places that need literal values (charts, SVG). Mirrors the tokens in app/globals.css. */
export const brand = {
  evergreen: "#0f5846",
  mint: "#6fdfb0",
  sage: "#9fb3a9",
  gold: "#d9a441",
  info: "#2d5b8c",
  warning: "#b26a00",
  danger: "#c4321f",
  text: "#111a16",
  textSecondary: "#4f5d56",
  textTertiary: "#606d66",
  hairline: "#e3e7e0",
  track: "#eceee8",
} as const

/** Series order for charts: this year, comparison, then supporting series. */
export const chartSeries = [brand.evergreen, brand.mint, brand.info, brand.gold, brand.sage, brand.textSecondary] as const

export const chartTooltipStyle = {
  borderRadius: 8,
  border: `1px solid ${brand.hairline}`,
  boxShadow: "0 16px 40px -12px rgba(17, 26, 22, 0.18), 0 2px 6px rgba(17, 26, 22, 0.06)",
  fontSize: 12,
}
