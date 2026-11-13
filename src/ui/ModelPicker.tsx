import { Check, ChevronDown, ChevronLeft, Search } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import {
  filterModels,
  nearestModel,
  prettyModel,
  readRecent,
  rememberRecent,
  type PickerChoice,
  type PickerModel,
  type PickerProvider,
  type RecentChoice,
} from "./modelList";
import { ProviderMark } from "./ProviderMark";

const ICON = { size: 14, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

type Data = Record<`data-${string}`, string | number | undefined>;

export interface ModelPickerProps extends Data {
  providers: readonly PickerProvider[] | null;
  /** The provider the current model belongs to, or `null` for the default one. */
  provider: string | null;
  /** The model id, or `null` for the provider's own default. */
  model: string | null;
  /** What Automatic means when no provider is named, from the route's own `default`. */
  defaultProvider?: string | null;
  /** The trigger's accessible name. */
  label?: string;
  className?: string;
  disabled?: boolean;
  onChange(choice: PickerChoice): void;
}

interface Option {
  kind: "auto" | "recent" | "model" | "custom";
  provider?: string;
  model?: string;
}

type Row = { kind: "header"; key: string; label: string; provider?: PickerProvider } | { kind: "option"; option: Option };

/**
 * One model picker for every AI surface: the diagrams' and flashcards' model, the Assistant's
 * default, and the composer's per-turn choice.
 *
 * A button opens a popover with a search field and a listbox — the WAI-ARIA combobox pattern, with
 * the arrow keys moving an active option, Enter choosing it, and Escape closing and returning the
 * focus to the button. The list is grouped by provider under the app's name for it, each group says
 * whether the provider could answer, and a row shows the readable name over the raw id. The last
 * five models chosen in this browser come first, and **Custom model id…** takes an id the provider
 * does not list, because provider lists go stale.
 *
 * The component is presentational: it is told the providers and the current choice, and answers a
 * choice. The two adapters in `modelList.ts` turn the routes' own answers into that shape.
 */
export function ModelPicker({
  providers,
  provider,
  model,
  defaultProvider,
  label = "Model",
  className,
  disabled,
  onChange,
  ...rest
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [custom, setCustom] = useState(false);
  const [customText, setCustomText] = useState("");
  const [recent, setRecent] = useState<RecentChoice[]>([]);
  const [box, setBox] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const customInput = useRef<HTMLInputElement>(null);
  const rowsEls = useRef<(HTMLDivElement | null)[]>([]);
  const id = useId();
  const listId = `${id}-list`;

  const list = useMemo(() => providers ?? [], [providers]);
  const effectiveProvider = provider ?? defaultProvider ?? list.find((p) => p.ready)?.id ?? list[0]?.id ?? null;
  const currentProvider = list.find((p) => p.id === effectiveProvider);
  const currentModel = model ? currentProvider?.models.find((m) => m.id === model) : undefined;
  const shown = model ? (currentModel?.label ?? prettyModel(model)) : "Automatic";

  /* A custom id that the provider does not list still belongs to its group when the picker reopens. */
  const withCurrent = useMemo(() => {
    if (!model || !currentProvider || currentProvider.models.some((m) => m.id === model)) return list;
    return list.map((p) =>
      p.id === currentProvider.id ? { ...p, models: [{ id: model, label: prettyModel(model) }, ...p.models] } : p,
    );
  }, [list, model, currentProvider]);

  const groups = useMemo(() => filterModels(withCurrent, query), [withCurrent, query]);
  const recents = query.trim() ? [] : recent;

  const rows = useMemo(() => {
    const out: Row[] = [{ kind: "option", option: { kind: "auto" } }];
    if (recents.length) {
      out.push({ kind: "header", key: "recent", label: "Recent" });
      for (const r of recents) out.push({ kind: "option", option: { kind: "recent", provider: r.provider, model: r.model } });
    }
    for (const group of groups) {
      out.push({ kind: "header", key: `provider:${group.provider.id}`, label: group.provider.label, provider: group.provider });
      for (const m of group.models)
        out.push({ kind: "option", option: { kind: "model", provider: group.provider.id, model: m.id } });
    }
    out.push({ kind: "option", option: { kind: "custom" } });
    return out;
  }, [recents, groups]);
  const options = useMemo(() => rows.flatMap((row) => (row.kind === "option" ? [row.option] : [])), [rows]);

  useEffect(() => setActive((a) => Math.min(a, Math.max(0, options.length - 1))), [options.length]);

  const close = useCallback((back = true) => {
    setOpen(false);
    setCustom(false);
    if (back) trigger.current?.focus();
  }, []);

  const show = () => {
    setRecent(readRecent());
    setQuery("");
    setActive(0);
    setCustom(false);
    setOpen(true);
  };

  /* The search field is where a keyboard lands on open; the custom field when that is the panel. */
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => (custom ? customInput.current : search.current)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, custom]);

  useEffect(() => {
    if (open && !custom) rowsEls.current[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open, custom]);

  /* A popover in a settings pane must not be clipped by it: it is fixed to the viewport, kept inside
     it with an edge, and flips above the trigger when there is more room there. At 390px it is the
     window less two margins. */
  useLayoutEffect(() => {
    if (!open) return;
    const place = (e?: Event) => {
      /* A scroll inside the list is not the page moving under the popover. */
      if (e?.target instanceof Node && popover.current?.contains(e.target)) return;
      const el = trigger.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const margin = 8;
      const width = Math.min(380, window.innerWidth - margin * 2);
      const left = Math.max(margin, Math.min(r.left, window.innerWidth - width - margin));
      const below = window.innerHeight - r.bottom - margin - 6;
      const above = r.top - margin - 6;
      const maxHeight = Math.min(420, Math.max(180, Math.max(below, above)));
      const top = below >= Math.min(maxHeight, 220) || below >= above ? r.bottom + 6 : Math.max(margin, r.top - 6 - maxHeight);
      setBox({ left, top, width, maxHeight });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const target = e.target as Node;
      if (popover.current?.contains(target) || trigger.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open, close]);

  const pick = (choice: PickerChoice) => {
    if (choice.model && choice.provider) setRecent(rememberRecent({ provider: choice.provider, model: choice.model }, recent));
    onChange(choice);
    close();
  };

  const choose = (option: Option) => {
    switch (option.kind) {
      case "auto":
        /* The provider stays as it was: `null` is still "the server's default", which is what
           Automatic means in Settings and what the Assistant also reads. */
        pick({ provider, model: null });
        return;
      case "recent":
      case "model":
        pick({ provider: option.provider ?? null, model: option.model ?? null });
        return;
      case "custom":
        setCustom(true);
        setCustomText(model ?? "");
        return;
    }
  };

  const move = (step: number) => setActive((a) => (options.length ? (a + step + options.length) % options.length : 0));

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(Math.max(0, options.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const option = options[active];
      if (option) choose(option);
    }
  };

  const onPopoverKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "Tab" || !popover.current) return;
    /* The popover is portalled out of the settings card, so the modal's own trap cannot see it.
       Keep Tab inside until it closes, or the focus would walk behind the scrim. */
    const nodes = Array.from(
      popover.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.getClientRects().length > 0);
    if (!nodes.length) return;
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const modelOf = (option: Option): PickerModel | undefined => {
    const p = withCurrent.find((x) => x.id === option.provider);
    return p?.models.find((m) => m.id === option.model);
  };
  const selected = (option: Option): boolean => {
    switch (option.kind) {
      case "auto":
        return model === null;
      case "recent":
      case "model":
        return option.provider === effectiveProvider && option.model === model;
      case "custom":
        return false;
    }
  };

  const customProvider = withCurrent.find((p) => p.id === effectiveProvider);
  const customTyped = customText.trim();
  const listed = customProvider?.models ?? [];
  const missing = customTyped !== "" && listed.length > 0 && !listed.some((m) => m.id === customTyped);
  const near = missing ? nearestModel(customTyped, listed) : undefined;

  const row = (option: Option, index: number) => {
    const body = (() => {
      switch (option.kind) {
        case "auto":
          return (
            <>
              <span className="dag-modelpicker__text">
                <span className="dag-modelpicker__name">Automatic</span>
                <span className="dag-modelpicker__id">
                  {currentProvider?.defaultModel
                    ? `The provider's default · ${prettyModel(currentProvider.defaultModel)}`
                    : "The provider's own default"}
                </span>
              </span>
              {selected(option) ? <Check {...ICON} className="dag-modelpicker__check" aria-hidden="true" /> : null}
            </>
          );
        case "custom":
          return (
            <span className="dag-modelpicker__text">
              <span className="dag-modelpicker__name">Custom model id…</span>
              <span className="dag-modelpicker__id">Type one, even if the provider does not list it</span>
            </span>
          );
        case "recent":
        case "model": {
          const found = modelOf(option);
          const label = found?.label ?? prettyModel(option.model ?? "");
          const providerLabel = withCurrent.find((p) => p.id === option.provider)?.label ?? option.provider;
          return (
            <>
              <span className="dag-modelpicker__text">
                <span className="dag-modelpicker__name">{label}</span>
                <span className="dag-modelpicker__id">
                  {option.kind === "recent" ? `${providerLabel} · ` : ""}
                  {option.model}
                </span>
              </span>
              {selected(option) ? <Check {...ICON} className="dag-modelpicker__check" aria-hidden="true" /> : null}
            </>
          );
        }
      }
    })();
    return (
      <div
        key={`${option.kind}:${option.provider ?? ""}:${option.model ?? ""}`}
        id={`${id}-opt-${index}`}
        role="option"
        aria-selected={selected(option)}
        data-dag-model-option={option.kind}
        ref={(el) => {
          rowsEls.current[index] = el;
        }}
        className={`dag-modelpicker__option${active === index ? " dag-modelpicker__option--active" : ""}`}
        onMouseEnter={() => setActive(index)}
        onClick={() => choose(option)}
      >
        {body}
      </div>
    );
  };

  let optionAt = -1;
  const listRows = rows.map((item) => {
    if (item.kind === "header") {
      return (
        <div key={item.key} className="dag-modelpicker__grouphead" role="presentation">
          {item.provider ? <ProviderMark provider={item.provider.id} size={13} nameFallback={false} /> : null}
          <span className="dag-modelpicker__provider">{item.label}</span>
          {item.provider ? (
            <span
              className="dag-modelpicker__status"
              data-dag-model-ready={item.provider.ready ? "1" : "0"}
              title={item.provider.why}
            >
              {item.provider.ready ? "Ready" : "Not set up"}
            </span>
          ) : null}
        </div>
      );
    }
    optionAt += 1;
    return row(item.option, optionAt);
  });

  return (
    <span className={`dag-modelpicker${className ? ` ${className}` : ""}`}>
      <button
        ref={trigger}
        type="button"
        className="dag-modelpicker__button"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        title={model ?? "The provider's default model"}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (!open && e.key === "ArrowDown") {
            e.preventDefault();
            show();
          }
        }}
        {...rest}
      >
        <ProviderMark provider={effectiveProvider} />
        <span className="dag-modelpicker__current">{shown}</span>
        <ChevronDown {...ICON} className="dag-modelpicker__chevron" aria-hidden="true" />
      </button>
      {open && box
        ? createPortal(
            <div
              ref={popover}
              className="dag-modelpicker__popover"
              style={{ left: box.left, top: box.top, width: box.width, maxHeight: box.maxHeight }}
              data-dag-model-popover=""
              onKeyDown={onPopoverKey}
            >
              {custom ? (
                <div className="dag-modelpicker__custom" data-dag-model-custom="">
                  <button
                    type="button"
                    className="dag-modelpicker__back"
                    onClick={() => {
                      setCustom(false);
                      setQuery("");
                      requestAnimationFrame(() => search.current?.focus());
                    }}
                  >
                    <ChevronLeft {...ICON} aria-hidden="true" />
                    <span>Back to the list</span>
                  </button>
                  <p className="dag-modelpicker__customLine">
                    A custom model id for <strong>{customProvider?.label ?? "the provider"}</strong>
                  </p>
                  <form
                    className="dag-modelpicker__customForm"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (customTyped) pick({ provider: effectiveProvider, model: customTyped });
                    }}
                  >
                    <input
                      ref={customInput}
                      className="dag-modelpicker__customInput"
                      data-dag-model-custom-input=""
                      aria-label="Custom model id"
                      spellCheck={false}
                      autoComplete="off"
                      value={customText}
                      placeholder="e.g. glm-5.3-flash"
                      onChange={(e) => setCustomText(e.target.value)}
                    />
                    <button type="submit" className="dag-button" disabled={!customTyped}>
                      Use model
                    </button>
                  </form>
                  {missing ? (
                    <p className="dag-modelpicker__note" data-dag-model-note="">
                      Not in {customProvider?.label ?? "this provider"}&rsquo;s list.{" "}
                      {near ? (
                        <>
                          <button
                            type="button"
                            className="dag-modelpicker__suggest"
                            data-dag-model-suggest=""
                            onClick={() => pick({ provider: effectiveProvider, model: near.id })}
                          >
                            {near.label}
                          </button>{" "}
                          is close.
                        </>
                      ) : null}
                    </p>
                  ) : null}
                  <p className="dag-modelpicker__hint">
                    Any id the provider accepts works, even one it does not list — lists go stale.
                  </p>
                </div>
              ) : (
                <>
                  <div className="dag-modelpicker__search">
                    <Search {...ICON} className="dag-modelpicker__searchIcon" aria-hidden="true" />
                    <input
                      ref={search}
                      className="dag-modelpicker__searchInput"
                      data-dag-model-search=""
                      type="text"
                      role="combobox"
                      aria-label="Search models"
                      aria-autocomplete="list"
                      aria-expanded={true}
                      aria-controls={listId}
                      aria-activedescendant={options[active] ? `${id}-opt-${active}` : undefined}
                      spellCheck={false}
                      autoComplete="off"
                      placeholder="Search models"
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setActive(0);
                      }}
                      onKeyDown={onSearchKey}
                    />
                  </div>
                  <div className="dag-modelpicker__list" id={listId} role="listbox" aria-label="Models">
                    {listRows}
                  </div>
                </>
              )}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
