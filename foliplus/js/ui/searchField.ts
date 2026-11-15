// ui/searchField — small DOM primitive for a search box inside a popup.
//
// This is deliberately NOT an aria-complete combobox builder: the caller owns
// the ARIA contract (role=combobox, aria-activedescendant, aria-controls) so a
// SearchControl input and a dropdown search input can each compose their own
// semantics from the same primitive without the primitive hardcoding one
// surface's roles. The primitive only builds an <input> with a clear button
// and a single status region (role=status + aria-live=polite) that the caller
// fills with either a no-result message or a footer count — never both.
//
// Contract:
// - The caller passes onInput (query changed) and onKeyDown (Escape handling
//   etc.). The primitive never closes or focuses anything itself.
// - setAriaActive(id) sets/clears aria-activedescendant on the input (the
//   caller decides when the active row changes).
// - setStatus(text) fills the single status region; null hides it.
// - clear() empties the input and fires onInput("") so the caller re-renders.

type SearchFieldOptions = {
  /** Placeholder text (caller-localized). */
  placeholder?: string;
  /** aria-label for the input (caller-localized). */
  ariaLabel?: string;
  /** Optional class for the <input> element (e.g. the shared input skin). */
  inputClass?: string;
  /** Called with the trimmed query on every input event (including clear). */
  onInput: (query: string) => void;
  /** Called for every keydown on the input (Escape, arrows, Enter, Tab). */
  onKeyDown?: (event: KeyboardEvent) => void;
};

type SearchField = {
  /** The <input> element (role/aria attributes are set by the caller). */
  element: HTMLInputElement;
  /** The single status region (role=status + aria-live=polite). The caller
   *  fills it via setStatus; it exists so both status and footer share one
   *  live region and never announce twice. */
  statusElement: HTMLElement;
  focus(): void;
  clear(): void;
  setAriaActive(id: string | null): void;
  setStatus(text: string | null): void;
};

const createSearchField = (opts: SearchFieldOptions): SearchField => {
  const input = document.createElement("input");
  input.type = "text";
  if (opts.inputClass) input.classList.add(opts.inputClass);
  input.setAttribute("autocomplete", "off");
  input.setAttribute("spellcheck", "false");
  if (opts.placeholder) input.setAttribute("placeholder", opts.placeholder);
  if (opts.ariaLabel) input.setAttribute("aria-label", opts.ariaLabel);

  const status = document.createElement("div");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;

  const onInputEvent = (): void => opts.onInput(input.value);
  input.addEventListener("input", onInputEvent);
  if (opts.onKeyDown) input.addEventListener("keydown", opts.onKeyDown);

  const clear = (): void => {
    if (input.value === "") return;
    input.value = "";
    opts.onInput("");
  };

  return {
    element: input,
    statusElement: status,
    focus: () => input.focus(),
    clear,
    setAriaActive: id => {
      if (id) input.setAttribute("aria-activedescendant", id);
      else input.removeAttribute("aria-activedescendant");
    },
    setStatus: text => {
      if (text) {
        status.textContent = text;
        status.hidden = false;
      } else {
        status.textContent = "";
        status.hidden = true;
      }
    },
  };
};

export { createSearchField };
export type { SearchField, SearchFieldOptions };
