"""Shared escaping constants for BaseControl tests.

Consumed by TestConfBlockEscaping, TestSharedHeaderEscaping, TestFoliumBaseline
and TestSafeJson — the four classes that pin the two script-emission sites'
behaviour against the same injection payloads.

Escaped forms are spelled with chr() so they survive shell heredoc mangling,
and the two U+2028/U+2029 literals are always built from chr() rather than
typed — a heredoc drops those code points.
"""

from __future__ import annotations

# Closes the enclosing script tag and starts a new executable one.
PAYLOAD = "</script><script>window.__pwn=1</script>"

# How htmlsafe_json_dumps rewrites a script-closing tag: two backslash escapes.
ESCAPED = chr(92) + "u003c/script" + chr(92) + "u003e"

# JS line terminators: valid JSON, but written bare they would end the
# enclosing statement instead of staying inside the string.
LS = chr(0x2028)
PS = chr(0x2029)
LINE_TERMINATORS = f"A{LS}B{PS}C"
LS_ESCAPED = chr(92) + "u2028"
PS_ESCAPED = chr(92) + "u2029"
