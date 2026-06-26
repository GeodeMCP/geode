import { useEffect, useRef } from "react";
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
} from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { geodeTheme, geodeHighlight } from "../editorTheme";
import type { Kind } from "../fileType";

/** Returns the CodeMirror language extension for a content kind (none for plain text). */
function langFor(kind: Kind): Extension {
  if (kind === "json") return json();
  if (kind === "markdown") return markdown();
  if (kind === "yaml") return yaml();
  return [];
}

/** A custom-themed CodeMirror 6 editor used for both the read-only Source view and the editable Edit view. */
export function CodeEditor({ value, kind, editable, onChange, onSave, onCancel }: {
  value: string;
  kind: Kind;
  editable: boolean;
  onChange?: (text: string) => void;
  onSave?: (text: string) => void;
  onCancel?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Hold the latest callbacks so the editor doesn't rebuild when they change identity.
  const cb = useRef({ onChange, onSave, onCancel });
  // Keep the latest callbacks current without rebuilding the editor.
  useEffect(() => { cb.current = { onChange, onSave, onCancel }; });

  // Build (and rebuild) the editor when the language or edit-mode changes.
  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(),
        history(), bracketMatching(),
        keymap.of([
          ...(editable
            ? [
                { key: "Mod-s", run: (v: EditorView) => { cb.current.onSave?.(v.state.doc.toString()); return true; } },
                { key: "Escape", run: () => { cb.current.onCancel?.(); return true; } },
                indentWithTab,
              ]
            : []),
          ...defaultKeymap, ...historyKeymap,
        ]),
        langFor(kind), geodeTheme, geodeHighlight, EditorView.lineWrapping,
        EditorView.editable.of(editable),
        EditorState.readOnly.of(!editable),
        EditorView.updateListener.of((u) => { if (u.docChanged) cb.current.onChange?.(u.state.doc.toString()); }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
    // value intentionally excluded — external value changes are handled by the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, editable]);

  // Push external value changes (e.g. switching files) without clobbering in-progress typing.
  useEffect(() => {
    const v = view.current;
    if (v && value !== v.state.doc.toString()) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  return <div className="cm-host" ref={host} />;
}
