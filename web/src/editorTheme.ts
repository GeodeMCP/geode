import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

/** CodeMirror view theme matching the GeodeMCP dashboard: transparent surface, hairline gutter, emerald caret/selection. */
export const geodeTheme: Extension = EditorView.theme(
  {
    "&": { backgroundColor: "transparent", color: "#f2f2f2", height: "100%", fontSize: "13px" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "'Geist Mono', monospace", lineHeight: "1.75", overflow: "auto" },
    ".cm-content": { caretColor: "#6ee7b7", padding: "12px 0" },
    ".cm-gutters": { backgroundColor: "transparent", color: "#555", border: "none", borderRight: "1px solid rgba(255,255,255,.07)" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 16px" },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,.03)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#a3a3a3" },
    "&.cm-focused .cm-cursor": { borderLeftColor: "#6ee7b7" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "rgba(52,211,153,.18)" },
  },
  { dark: true },
);

/** Syntax token colours, mapped from the GeodeMCP palette (emerald keys, blue strings, amber numbers, violet literals). */
const geodeHighlightStyle = HighlightStyle.define([
  { tag: [t.propertyName, t.keyword], color: "#6ee7b7" },
  { tag: [t.string, t.special(t.string)], color: "#9fc0e8" },
  { tag: t.number, color: "#e0b072" },
  { tag: [t.bool, t.null, t.atom], color: "#c98fd0" },
  { tag: [t.punctuation, t.separator, t.bracket], color: "#777" },
  { tag: t.heading, color: "#e0b072", fontWeight: "600" },
  { tag: [t.link, t.url], color: "#9fc0e8" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.comment, color: "#555", fontStyle: "italic" },
]);

/** Editor extension that applies the GeodeMCP syntax highlighting. */
export const geodeHighlight: Extension = syntaxHighlighting(geodeHighlightStyle);
