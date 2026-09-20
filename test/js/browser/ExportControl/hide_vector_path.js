() => {
  const paths = document.querySelectorAll('path');
  const redPaths = [];
  let hiddenCount = 0;
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    const fill = p.fill || p.getAttribute('fill') || '';
    const stroke = p.stroke || p.getAttribute('stroke') || '';
    const style = p.getAttribute('style') || '';
    const isRed = fill.includes('230') || stroke.includes('230') || style.includes('230') ||
                  fill.includes('red') || stroke.includes('red') || style.includes('red');
    if (isRed) {
      redPaths.push({i: i, fill: fill, stroke: stroke});
      p.style.display = 'none';
      hiddenCount++;
    }
  }
  return { hidden: hiddenCount > 0, count: hiddenCount, redPaths: redPaths, totalPaths: paths.length };
}
