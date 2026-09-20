() => {
  // Hide all SVG paths whose fill or stroke contains blue (rgb(0,0,230))
  // via visibility:hidden (not display:none). This tests whether the
  // SVG-to-img pipeline respects inline visibility:hidden.
  const paths = document.querySelectorAll("path");
  let hiddenCount = 0;
  for (const p of paths) {
    const fill = p.getAttribute("fill") || "";
    const stroke = p.getAttribute("stroke") || "";
    const style = p.getAttribute("style") || "";
    const isBlue =
      fill.includes("0,0,230") ||
      stroke.includes("0,0,230") ||
      style.includes("0,0,230");
    if (isBlue) {
      p.style.visibility = "hidden";
      hiddenCount++;
    }
  }
  return { hidden: hiddenCount > 0, count: hiddenCount };
}
