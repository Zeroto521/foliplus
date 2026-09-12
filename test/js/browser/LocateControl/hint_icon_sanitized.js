() => {
  // End-to-end vector for the hint-icon sink. The registered icon string is
  // sanitised at registration, then reaches the DOM through insertAdjacentHTML
  // via `dom.el`'s `{ html }` child — so the browser re-parses whatever the
  // allowlist serialised. jsdom cannot reach this path: its DOMParser and
  // insertion model disagree with a real browser's, so only a browser can show
  // what actually lands in the DOM and whether any of it is still live.
  //
  // Four payloads. The first is hostile in every axis at once — root
  // event-handler, inline script, a foreignObject body/img breakout, and a
  // child event-handler — so the assertion is "nothing live survives". The
  // second shows the foreignObject rule is load-bearing. The third is benign
  // apart from one `class` attribute, so the assertion is "presentation
  // attributes and text survive". The last is all active content, so the
  // assertion is "the icon is dropped and the text stays".
  const key = "xss-hint-probe-" + Date.now();

  const reg = window.map.foliplus.registerHintIcon;
  const show = window.map.foliplus.showHint;

  // --- 1. Full hostile payload: strip everything active, keep nothing runnable
  const HOSTILE =
    '<svg xmlns="http://www.w3.org/2000/svg" class="foliplus-spin" viewBox="0 0 8 8" onload="window.__pwn1=1">' +
    "<script>window.__pwn2=1</script>" +
    '<foreignObject><body><img src=x onerror="window.__pwn3=1"></body></foreignObject>' +
    '<rect width="4" height="4" class="foliplus-spin" onmouseover="window.__pwn4=1"/></svg>';
  reg(key + "-hostile", HOSTILE);
  const poisonText = "<img src=x onerror=alert(1)>probe";
  show(key + "-hostile", poisonText, 0);

  const hostile = document.querySelector(
    ".foliplus-hint.foliplus-hint-" + key + "-hostile",
  );
  const hostileIcon = hostile ? hostile.querySelector(".foliplus-hint-icon") : null;

  // --- 2. foreignObject holding only SVG children. An empty foreignObject is
  //     inert, but one carrying SVG children is not — a `<foreignObject>` inside
  //     an `<svg>` is the one place the browser is allowed to host inline markup
  //     for layout, so if this were re-introduced later the gate would need a
  //     rule for it, not the tag blacklist. This pins that the blacklist is
  //     what is doing the work.
  const FOREIGN_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">' +
    '<foreignObject><g><rect width="2" height="2" class="foliplus-spin"/></g></foreignObject>' +
    '<rect width="4" height="4" class="foliplus-spin"/></svg>';
  reg(key + "-foreignsvg", FOREIGN_SVG);
  show(key + "-foreignsvg", "fsvg", 0);
  const foreignSvg = document.querySelector(
    ".foliplus-hint.foliplus-hint-" + key + "-foreignsvg",
  );

  // --- 3. Benign payload: presentation attributes must survive the allowlist
  const BENEIGN =
    '<svg class="foliplus-spin" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">' +
    '<rect width="4" height="4" class="foliplus-spin" fill="currentColor" stroke="currentColor"/></svg>';
  reg(key + "-benign", BENEIGN);
  show(key + "-benign", "locating", 0);

  const benign = document.querySelector(
    ".foliplus-hint.foliplus-hint-" + key + "-benign",
  );
  const benignIcon = benign ? benign.querySelector(".foliplus-hint-icon") : null;
  const svg = benignIcon ? benignIcon.querySelector("svg") : null;
  const rect = svg ? svg.querySelector("rect") : null;

  // --- 4. Whole tree active: no presentational residue left to keep
  reg(key + "-dead", "<script>window.__pwn5=1</script>");
  show(key + "-dead", "dead", 0);
  const dead = document.querySelector(".foliplus-hint.foliplus-hint-" + key + "-dead");

  const roundTrip = svg
    ? (() => {
        // Force the second parse the sink performs on every re-serialise.
        const holder = document.createElement("div");
        holder.innerHTML = svg.outerHTML;
        const r = holder.querySelector("svg");
        return {
          svg: !!r,
          matches: r ? r.matches(".foliplus-spin") : false,
          rectMatches:
            r && r.querySelector("rect")
              ? r.querySelector("rect").matches(".foliplus-spin")
              : false,
        };
      })()
    : { svg: false, matches: false, rectMatches: false };

  return {
    hostile: {
      hint: !!hostile,
      iconSpan: !!hostileIcon,
      scripts: hostile ? hostile.querySelectorAll("script").length : -1,
      imgs: hostile ? hostile.querySelectorAll("img").length : -1,
      foreign: hostile ? hostile.querySelectorAll("foreignobject").length : -1,
      foreignChildren:
        hostile && hostile.querySelector("foreignobject")
          ? hostile.querySelector("foreignobject").childNodes.length
          : -1,
      onload: hostile ? /onload/i.test(hostile.innerHTML) : false,
      onmouseover: hostile ? /onmouseover/i.test(hostile.innerHTML) : false,
      text: hostile ? hostile.textContent : null,
      html: hostile ? hostile.innerHTML : null,
    },
    foreignSvg: {
      hint: !!foreignSvg,
      foreign: foreignSvg ? foreignSvg.querySelectorAll("foreignobject").length : -1,
      rectInsideForeign: foreignSvg
        ? foreignSvg.querySelectorAll("foreignobject rect").length
        : -1,
      text: foreignSvg ? foreignSvg.textContent : null,
    },
    benign: {
      hint: !!benign,
      iconSpan: !!benignIcon,
      svg: !!svg,
      rootClass: svg ? svg.getAttribute("class") : null,
      rootMatches: svg ? svg.matches(".foliplus-spin") : false,
      rectClass: rect ? rect.getAttribute("class") : null,
      rectMatches: rect ? rect.matches(".foliplus-spin") : false,
      fill: rect ? rect.getAttribute("fill") : null,
      stroke: rect ? rect.getAttribute("stroke") : null,
      text: benign ? benign.textContent : null,
    },
    roundTrip,
    dropped: {
      iconSpan: dead ? !!dead.querySelector(".foliplus-hint-icon") : null,
      text: dead ? dead.textContent : null,
    },
    poisonText,
    leaked: ["__pwn1", "__pwn2", "__pwn3", "__pwn4", "__pwn5"].map(k => window[k]),
  };
};
