// Chart colours. SVG attributes set by Recharts can't read CSS variables
// reliably, so these mirror the tokens at the top of styles.css. Change
// both together.
export const chartColors = {
  bar: "#2de2cf",
  barToday: "#8ff5ea",
  gap: "#3a4644",
  grid: "#1a1f1e",
  axis: "#8a9895",
  average: "#c9d3d1",
  cursor: "rgba(45, 226, 207, 0.08)",
} as const;
