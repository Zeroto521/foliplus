import { beforeEach, describe, expect, it } from "vitest";
import { createScopedTranslator, createTranslator } from "#common/locale.js";

describe("createTranslator", () => {
  beforeEach(() => {
    // Common tables injected into the runtime global.
    window.foliplus._TABLES = {
      en: { ok: "OK", greeting: "Hello", "locale.code": "en" },
      zh: { ok: "确定", greeting: "你好", "locale.code": "zh" },
    };
  });

  it("uses explicit locale code from conf", () => {
    const conf = {
      locale_code: "zh",
      locale_tables: { zh: { ok: "确定" } },
    };
    const t = createTranslator(conf);
    expect(conf.locale_code).toBe("zh");
    expect(t("ok")).toBe("确定");
    expect(t("greeting")).toBe("你好");
  });

  it("merges component tables over common tables", () => {
    const conf = {
      locale_code: "en",
      locale_tables: { en: { ok: "YES" } },
    };
    const t = createTranslator(conf);
    expect(t("ok")).toBe("YES"); // component overrides common
    expect(t("greeting")).toBe("Hello"); // common still available
  });

  it("returns the key when missing from the table", () => {
    const conf = { locale_code: "en", locale_tables: {} };
    const t = createTranslator(conf);
    expect(t("missing.key")).toBe("missing.key");
  });

  it("auto-detects locale from navigator.language", () => {
    const original = navigator.language;
    Object.defineProperty(navigator, "language", {
      configurable: true,
      get: () => "zh-CN",
    });
    try {
      const conf = {
        locale_code: "",
        locale_tables: { zh: { ok: "确定", "locale.code": "zh" } },
      };
      const t = createTranslator(conf);
      expect(conf.locale_code).toBe("zh");
      expect(t("ok")).toBe("确定");
    } finally {
      Object.defineProperty(navigator, "language", {
        configurable: true,
        get: () => original,
      });
    }
  });

  it("falls back to en when locale unsupported", () => {
    const original = navigator.language;
    Object.defineProperty(navigator, "language", {
      configurable: true,
      get: () => "fr-FR",
    });
    try {
      const conf = {
        locale_code: "",
        locale_tables: { en: { ok: "OK", "locale.code": "en" } },
      };
      const t = createTranslator(conf);
      expect(conf.locale_code).toBe("en");
      expect(t("ok")).toBe("OK");
    } finally {
      Object.defineProperty(navigator, "language", {
        configurable: true,
        get: () => original,
      });
    }
  });

  it("handles missing common tables", () => {
    delete window.foliplus._TABLES;
    const conf = { locale_code: "en", locale_tables: { en: { ok: "OK" } } };
    const t = createTranslator(conf);
    expect(t("ok")).toBe("OK");
  });

  it("detects locale from parent iframe path", () => {
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: {
        location: { pathname: "/zh/embed/map" },
        document: { documentElement: { lang: "" } },
      },
    });
    try {
      const conf = {
        locale_code: "",
        locale_tables: { zh: { ok: "确定", "locale.code": "zh" } },
      };
      const t = createTranslator(conf);
      expect(conf.locale_code).toBe("zh");
      expect(t("ok")).toBe("确定");
    } finally {
      delete window.parent;
    }
  });

  it("detects locale from parent iframe html lang attribute", () => {
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: {
        location: { pathname: "/embed/map" },
        document: { documentElement: { lang: "zh-CN" } },
      },
    });
    try {
      const conf = {
        locale_code: "",
        locale_tables: { zh: { ok: "确定", "locale.code": "zh" } },
      };
      const t = createTranslator(conf);
      expect(conf.locale_code).toBe("zh");
    } finally {
      delete window.parent;
    }
  });

  it("ignores cross-origin parent iframe errors", () => {
    Object.defineProperty(window, "parent", {
      configurable: true,
      get: () => window, // accessing location may throw in some envs
    });
    try {
      const conf = {
        locale_code: "",
        locale_tables: { en: { ok: "OK", "locale.code": "en" } },
      };
      const t = createTranslator(conf);
      expect(conf.locale_code).toBe("en");
    } finally {
      delete window.parent;
    }
  });

  it("detects locale from window URL path when no iframe", () => {
    const original = window.location.pathname;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/zh/map" },
    });
    try {
      const conf = {
        locale_code: "",
        locale_tables: { zh: { ok: "确定", "locale.code": "zh" } },
      };
      const t = createTranslator(conf);
      expect(conf.locale_code).toBe("zh");
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: { pathname: original },
      });
    }
  });

  it("detects locale from document referrer", () => {
    const original = document.referrer;
    Object.defineProperty(document, "referrer", {
      configurable: true,
      get: () => "https://example.com/zh/page",
    });
    try {
      const conf = {
        locale_code: "",
        locale_tables: { zh: { ok: "确定", "locale.code": "zh" } },
      };
      const t = createTranslator(conf);
      expect(conf.locale_code).toBe("zh");
    } finally {
      Object.defineProperty(document, "referrer", {
        configurable: true,
        get: () => original,
      });
    }
  });

  it("detects locale from html lang attribute", () => {
    const original = document.documentElement.lang;
    document.documentElement.lang = "zh-CN";
    try {
      const conf = {
        locale_code: "",
        locale_tables: { zh: { ok: "确定", "locale.code": "zh" } },
      };
      const t = createTranslator(conf);
      expect(conf.locale_code).toBe("zh");
    } finally {
      document.documentElement.lang = original;
    }
  });
});

describe("createScopedTranslator", () => {
  beforeEach(() => {
    window.foliplus._TABLES = {
      en: { ok: "OK" },
    };
  });

  it("prepends conf.name to the key", () => {
    const conf = {
      name: "LayerControl",
      locale_code: "en",
      locale_tables: { en: { "LayerControl.focus": "Focus layer" } },
    };
    const T = createScopedTranslator(conf);
    expect(T("focus")).toBe("Focus layer");
    expect(T("missing")).toBe("LayerControl.missing");
  });

  it("falls back to the prefixed key when translation is absent", () => {
    const conf = {
      name: "SearchControl",
      locale_code: "en",
      locale_tables: { en: {} },
    };
    const T = createScopedTranslator(conf);
    expect(T("bar")).toBe("SearchControl.bar");
  });

  it("uses the shared common table for missing component keys", () => {
    window.foliplus._TABLES = {
      en: {
        ok: "OK",
        "LayerControl.ok": "Layer OK",
      },
    };
    const conf = {
      name: "LayerControl",
      locale_code: "en",
      locale_tables: { en: {} },
    };
    const T = createScopedTranslator(conf);
    expect(T("ok")).toBe("Layer OK");
  });

  it("uses component table over common for same prefixed key", () => {
    window.foliplus._TABLES = {
      en: { "LayerControl.ok": "Layer OK" },
    };
    const conf = {
      name: "LayerControl",
      locale_code: "en",
      locale_tables: { en: { "LayerControl.ok": "Layer Override" } },
    };
    const T = createScopedTranslator(conf);
    expect(T("ok")).toBe("Layer Override");
  });
});
