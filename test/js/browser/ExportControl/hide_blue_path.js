() => {
  // Hide all SVG paths whose fill or stroke contains blue (rgb(0,0,230)).
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
      p.style.display = "none";
      hiddenCount++;
    }
  }
  return { hidden: hiddenCount > 0, count: hiddenCount };
}
