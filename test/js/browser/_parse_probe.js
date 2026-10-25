// Shared with test/python/infra/test_browser_probe_smoke.py: compile the
// whole probe corpus with the two-step rule Playwright's page.evaluate uses
// (an expression first, then a function body). Files starting with `_` are
// support helpers, not probes, so the inventory gate skips this file.
probes =>
  probes.flatMap(({ name, source }) => {
    try {
      new Function(`return (${source})`);
      return [];
    } catch {
      try {
        new Function(source);
        return [];
      } catch (error) {
        return [`${name}: ${error.message}`];
      }
    }
  });
