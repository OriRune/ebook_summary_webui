"""
Ebook → Summaries & Flashcards
A small reusable desktop GUI:
  1. Pick an ebook (.txt / .md / .epub)
  2. Split it into digestible chapters/sections, and check/uncheck which
     sections to process (skip indexes, "praise for" pages, etc.)
  3. Send each checked section to Claude for a summary, and optionally
     flashcards and/or discussion questions
  4. Browse the results and export to CSV (Anki) / Markdown

Run with:  python main.py
"""

from __future__ import annotations

import os
import re
import queue
import threading
import time
import tkinter as tk
from tkinter import ttk, filedialog, messagebox, simpledialog

import config
from parser import split_ebook, detect_title_author, Section, PART_RE
from llm_client import (
    generate_section_content,
    SectionResult,
    DEFAULT_MODEL,
    CharacterNote,
    CharacterSummary,
    consolidate_character_list,
    estimate_run_cost,
    get_ollama_models,
    get_groq_models,
    ChapterContinuityTracker,
)
from exporter import (
    export_flashcards_csv,
    export_cloze_flashcards_csv,
    count_cloze_flashcards,
    export_summaries_markdown,
    export_summaries_docx,
)

CHECKED = "☑"
UNCHECKED = "☐"

# Maps the friendly dropdown label to the value passed through to the LLM client
CONTENT_TYPE_OPTIONS = {
    "Auto-detect": "auto",
    "Fiction": "fiction",
    "Nonfiction": "nonfiction",
}

_FILENAME_UNSAFE = re.compile(r'[^\w\s-]')
_FILENAME_SPACES = re.compile(r'\s+')

# --- Light/dark color palettes -------------------------------------------- #
# Used by _apply_theme() to configure ttk.Style (which covers every themed
# widget — frames, labels, buttons, entries, the notebook, the tree, etc.) and
# to manually recolor the handful of classic tk.Text widgets, which predate
# ttk and don't follow its styles. Keys are shared between the two palettes so
# _apply_theme can stay palette-agnostic — picking one dict based on the
# toggle and applying it uniformly.
_LIGHT_PALETTE = {
    "bg": "#f0f0f0",
    "fg": "#000000",
    "muted_fg": "#555555",
    "help_fg": "#777777",
    "entry_bg": "#ffffff",
    "entry_fg": "#000000",
    "text_bg": "#ffffff",
    "text_fg": "#000000",
    "select_bg": "#0078d7",
    "select_fg": "#ffffff",
    "button_bg": "#e1e1e1",
    "tree_bg": "#ffffff",
    "tree_fg": "#000000",
}

_DARK_PALETTE = {
    "bg": "#2b2b2b",
    "fg": "#e0e0e0",
    "muted_fg": "#a0a0a0",
    "help_fg": "#8a8a8a",
    "entry_bg": "#3c3c3c",
    "entry_fg": "#e0e0e0",
    "text_bg": "#1e1e1e",
    "text_fg": "#d4d4d4",
    "select_bg": "#3a6ea5",
    "select_fg": "#ffffff",
    "button_bg": "#3c3c3c",
    "tree_bg": "#252525",
    "tree_fg": "#d4d4d4",
}


def _sanitize_filename_part(s: str) -> str:
    s = _FILENAME_UNSAFE.sub('', s).strip()
    s = _FILENAME_SPACES.sub('_', s)
    return s


class EbookFlashcardsApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Ebook → Summaries & Flashcards")
        self.geometry("1040x700")
        self.minsize(860, 580)

        self.ebook_path: str | None = None
        self.sections: list[Section] = []
        self.results: dict[int, SectionResult] = {}  # section index -> result
        self.section_checked: dict[int, bool] = {}   # section index -> include in generation?
        self.character_list: list[CharacterSummary] = []  # book-level: main characters (fiction only)
        self.character_list_error: str | None = None
        self._work_queue: "queue.Queue" = queue.Queue()
        self._generating = False
        self._stop_requested = False

        # Live elapsed-time / ETA readout during a generation run (see
        # _tick_timer, _on_generate, _poll_queue). _gen_start_time is a
        # monotonic timestamp (None when not generating); _gen_completed is
        # how many of the checked sections have finished so far. _gen_eta is
        # the current "About M:SS left" countdown in seconds (None until the
        # first section finishes, since there's no basis for an estimate yet)
        # — it's recomputed only at the moment each new section starts (as
        # "average time per completed section so far" × sections remaining),
        # then simply ticks down by one second per display refresh until the
        # next completion lands a fresh number. Recalculating it from live
        # elapsed time on every tick would make it visibly creep upward
        # between completions (elapsed keeps growing while the completed
        # count briefly stands still) — ticking it down avoids that.
        self._gen_start_time: float | None = None
        self._gen_completed = 0
        self._gen_eta: float | None = None

        # Dark mode: persisted across runs via config.py. _text_widgets
        # collects the classic tk.Text panes (which predate ttk and don't
        # follow ttk.Style) so _apply_theme can recolor them by hand; built up
        # as _build_layout creates each one. _style is the shared ttk.Style
        # instance _apply_theme reconfigures whenever the toggle flips.
        self.dark_mode_var = tk.BooleanVar(value=config.load_dark_mode())
        self._text_widgets: list[tk.Text] = []
        self._style = ttk.Style(self)

        self._build_layout()
        self._apply_theme()
        self._poll_queue()

    # ---------------------------------------------------------------- theme

    def _on_dark_mode_toggled(self):
        config.save_dark_mode(self.dark_mode_var.get())
        self._apply_theme()

    def _apply_theme(self):
        """(Re)configure every themed widget for the current light/dark
        setting. Safe to call any time after _build_layout — re-running it
        (e.g. when the toggle flips) simply reconfigures styles in place,
        which ttk propagates live to all existing widgets using them.

        Uses the "clam" theme as a base because, unlike the platform-default
        theme, it honors background/foreground overrides consistently across
        widget classes — the prerequisite for a real dark mode. The classic
        tk.Text panes aren't ttk widgets at all and are recolored by hand via
        _text_widgets."""
        palette = _DARK_PALETTE if self.dark_mode_var.get() else _LIGHT_PALETTE
        style = self._style
        style.theme_use("clam")

        style.configure(".", background=palette["bg"], foreground=palette["fg"],
                        fieldbackground=palette["entry_bg"])
        style.configure("TFrame", background=palette["bg"])
        style.configure("TLabel", background=palette["bg"], foreground=palette["fg"])
        style.configure("TButton", background=palette["button_bg"], foreground=palette["fg"])
        style.map("TButton",
                  background=[("active", palette["select_bg"]), ("disabled", palette["bg"])],
                  foreground=[("disabled", palette["help_fg"])])
        style.configure("TCheckbutton", background=palette["bg"], foreground=palette["fg"])
        style.map("TCheckbutton",
                  background=[("active", palette["bg"])],
                  foreground=[("disabled", palette["help_fg"])])
        style.configure("TEntry", fieldbackground=palette["entry_bg"], foreground=palette["entry_fg"],
                        insertcolor=palette["fg"])
        style.configure("TSpinbox", fieldbackground=palette["entry_bg"], foreground=palette["entry_fg"],
                        background=palette["button_bg"], arrowcolor=palette["fg"],
                        insertcolor=palette["fg"])
        style.configure("TCombobox", fieldbackground=palette["entry_bg"], foreground=palette["entry_fg"],
                        background=palette["button_bg"], arrowcolor=palette["fg"])
        style.map("TCombobox",
                  fieldbackground=[("readonly", palette["entry_bg"])],
                  foreground=[("readonly", palette["entry_fg"])])
        style.configure("TNotebook", background=palette["bg"], borderwidth=0)
        style.configure("TNotebook.Tab", background=palette["button_bg"], foreground=palette["fg"],
                        padding=(10, 4))
        style.map("TNotebook.Tab",
                  background=[("selected", palette["bg"])],
                  foreground=[("selected", palette["fg"])])
        style.configure("TPanedwindow", background=palette["bg"])
        style.configure("TProgressbar", background=palette["select_bg"], troughcolor=palette["entry_bg"])
        style.configure("TSeparator", background=palette["help_fg"])
        style.configure("Treeview", background=palette["tree_bg"], fieldbackground=palette["tree_bg"],
                        foreground=palette["tree_fg"])
        style.map("Treeview",
                  background=[("selected", palette["select_bg"])],
                  foreground=[("selected", palette["select_fg"])])
        style.configure("Treeview.Heading", background=palette["button_bg"], foreground=palette["fg"])
        style.configure("Vertical.TScrollbar", background=palette["button_bg"],
                        troughcolor=palette["bg"], arrowcolor=palette["fg"])
        style.configure("Horizontal.TScrollbar", background=palette["button_bg"],
                        troughcolor=palette["bg"], arrowcolor=palette["fg"])

        # Named styles standing in for what used to be hardcoded
        # foreground=/font= kwargs, so every label of a given "role" — muted
        # status text, small grey help text, the bold result-pane title —
        # repaints correctly when the theme switches.
        style.configure("Muted.TLabel", background=palette["bg"], foreground=palette["muted_fg"])
        style.configure("Help.TLabel", background=palette["bg"], foreground=palette["help_fg"])
        style.configure("Bold.TLabel", background=palette["bg"], foreground=palette["fg"],
                        font=("TkDefaultFont", 12, "bold"))

        # Classic tk.Text widgets: not ttk, so they need manual recoloring.
        for widget in self._text_widgets:
            widget.configure(
                background=palette["text_bg"], foreground=palette["text_fg"],
                insertbackground=palette["fg"],
                selectbackground=palette["select_bg"], selectforeground=palette["select_fg"],
            )

        self.configure(background=palette["bg"])

    # ------------------------------------------------------------------ UI

    def _add_help_label(self, parent, text):
        """A small grey explanatory label that re-wraps to fit whatever width
        is actually available — recalculated on every resize — instead of
        being clipped or hidden when the window is narrower than the text
        would need on one line."""
        label = ttk.Label(parent, text=text, style="Help.TLabel")
        label.pack(side="left", padx=8)

        def _update_wrap(_event=None):
            avail = parent.winfo_width() - label.winfo_x() - 16
            if avail > 80:
                label.config(wraplength=avail)

        parent.bind("<Configure>", _update_wrap, add="+")
        label.bind("<Configure>", _update_wrap, add="+")
        return label

    def _build_layout(self):
        pad = {"padx": 8, "pady": 6}

        # --- Top: file + settings ---
        top = ttk.Frame(self)
        top.pack(fill="x", **pad)

        ttk.Button(top, text="Open Ebook…", command=self._on_open_ebook).pack(side="left")
        self.file_label = ttk.Label(top, text="No file loaded", style="Muted.TLabel")
        self.file_label.pack(side="left", padx=10)

        ttk.Checkbutton(top, text="Dark mode", variable=self.dark_mode_var,
                        command=self._on_dark_mode_toggled).pack(side="right", padx=8)

        # --- Book title / author (auto-filled, editable; used for export filenames) ---
        book_info = ttk.Frame(self)
        book_info.pack(fill="x", **pad)
        ttk.Label(book_info, text="Book title:").pack(side="left")
        self.title_var = tk.StringVar(value="")
        ttk.Entry(book_info, textvariable=self.title_var, width=34).pack(side="left", padx=6)
        ttk.Label(book_info, text="Author:").pack(side="left", padx=(14, 0))
        self.author_var = tk.StringVar(value="")
        ttk.Entry(book_info, textvariable=self.author_var, width=26).pack(side="left", padx=6)
        self._add_help_label(
            book_info,
            "(auto-filled when detectable — edit freely; used to name exported files)")

        settings = ttk.Frame(self)
        settings.pack(fill="x", **pad)

        # --- Backend selector -------------------------------------------------
        ttk.Label(settings, text="Backend:").pack(side="left")
        self.backend_var = tk.StringVar(value="Anthropic API")
        backend_combo = ttk.Combobox(
            settings, textvariable=self.backend_var, state="readonly", width=14,
            values=["Anthropic API", "Ollama (local)", "Groq"],
        )
        backend_combo.pack(side="left", padx=6)

        # --- Anthropic API key widgets (shown when backend = Anthropic) -------
        self._anthropic_widgets_frame = ttk.Frame(settings)
        self._anthropic_widgets_frame.pack(side="left")
        ttk.Label(self._anthropic_widgets_frame, text="API key:").pack(side="left")
        self.api_key_var = tk.StringVar(value=config.load_api_key())
        self.api_key_entry = ttk.Entry(
            self._anthropic_widgets_frame, textvariable=self.api_key_var, show="•", width=40)
        self.api_key_entry.pack(side="left", padx=6)
        ttk.Button(self._anthropic_widgets_frame, text="Save key",
                   command=self._on_save_key).pack(side="left")

        # --- Ollama widgets (shown when backend = Ollama, hidden initially) ---
        self._ollama_widgets_frame = ttk.Frame(settings)
        # (not packed yet — _on_backend_changed shows/hides these two frames)
        ttk.Label(self._ollama_widgets_frame, text="Model:").pack(side="left")
        self.ollama_model_var = tk.StringVar(value="")
        self.ollama_model_combo = ttk.Combobox(
            self._ollama_widgets_frame, textvariable=self.ollama_model_var,
            state="readonly", width=24, values=[],
        )
        self.ollama_model_combo.pack(side="left", padx=6)
        ttk.Button(self._ollama_widgets_frame, text="↺ Refresh models",
                   command=self._refresh_ollama_models).pack(side="left")
        self.ollama_status_label = ttk.Label(
            self._ollama_widgets_frame, text="", style="Muted.TLabel")
        self.ollama_status_label.pack(side="left", padx=6)

        # --- Groq widgets (shown when backend = Groq, hidden initially) ------
        self._groq_widgets_frame = ttk.Frame(settings)
        # (not packed yet — _on_backend_changed shows/hides all backend frames)
        ttk.Label(self._groq_widgets_frame, text="API key:").pack(side="left")
        self.groq_api_key_var = tk.StringVar(value=config.load_groq_api_key())
        self.groq_api_key_entry = ttk.Entry(
            self._groq_widgets_frame, textvariable=self.groq_api_key_var, show="•", width=28)
        self.groq_api_key_entry.pack(side="left", padx=6)
        ttk.Button(self._groq_widgets_frame, text="Save key",
                   command=self._on_save_groq_key).pack(side="left")
        ttk.Label(self._groq_widgets_frame, text="  Model:").pack(side="left")
        self.groq_model_var = tk.StringVar(value="")
        self.groq_model_combo = ttk.Combobox(
            self._groq_widgets_frame, textvariable=self.groq_model_var,
            state="readonly", width=26, values=[],
        )
        self.groq_model_combo.pack(side="left", padx=6)
        ttk.Button(self._groq_widgets_frame, text="↺ Refresh models",
                   command=self._refresh_groq_models).pack(side="left")
        self.groq_status_label = ttk.Label(
            self._groq_widgets_frame, text="", style="Muted.TLabel")
        self.groq_status_label.pack(side="left", padx=6)

        self.backend_var.trace_add("write", self._on_backend_changed)

        ttk.Label(settings, text="   Max chars/section:").pack(side="left", padx=(16, 0))
        self.max_chars_var = tk.IntVar(value=9000)
        ttk.Spinbox(settings, from_=2000, to=30000, increment=1000, width=8,
                    textvariable=self.max_chars_var).pack(side="left", padx=6)

        # Subtle divider between the "book + credentials" group above and the
        # "what to generate" group below — purely visual, no functional role.
        ttk.Separator(self, orient="horizontal").pack(fill="x", padx=8, pady=(2, 4))

        # --- What to generate ---
        generate_opts = ttk.Frame(self)
        generate_opts.pack(fill="x", **pad)
        ttk.Label(generate_opts, text="Generate:").pack(side="left")
        self.summary_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(generate_opts, text="Summary", variable=self.summary_var).pack(side="left", padx=6)
        self.flashcards_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(generate_opts, text="Flashcards", variable=self.flashcards_var).pack(side="left", padx=6)
        self.discussion_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(generate_opts, text="Discussion questions", variable=self.discussion_var).pack(side="left", padx=6)

        ttk.Label(generate_opts, text="   Content is:").pack(side="left", padx=(16, 0))
        self.content_type_var = tk.StringVar(value="Auto-detect")
        ttk.Combobox(generate_opts, textvariable=self.content_type_var, state="readonly", width=12,
                     values=list(CONTENT_TYPE_OPTIONS.keys())).pack(side="left", padx=6)
        self._add_help_label(
            generate_opts,
            "(set this to skip having Claude figure out fiction vs. nonfiction)")

        # --- Cross-section context (optional; off by default — keeps the
        # default behavior identical to before: each section sent in isolation) ---
        context_opts = ttk.Frame(self)
        context_opts.pack(fill="x", **pad)
        self.rolling_context_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(context_opts, text="Carry story context forward between sections",
                        variable=self.rolling_context_var).pack(side="left")
        self._add_help_label(
            context_opts,
            "(off by default — each section is sent to Claude on its own, with no "
            "knowledge of what came before. Turning this on has Claude build a brief "
            "running recap as it goes and pass it forward, so later sections can draw "
            "on earlier events. Rides along on the calls you're already making — adds "
            "a little to each one's tokens — and works best when sections are processed "
            "in book order with none skipped)")

        # --- Character list (fiction only) ---
        character_opts = ttk.Frame(self)
        character_opts.pack(fill="x", **pad)
        self.character_list_var = tk.BooleanVar(value=False)
        self.character_list_check = ttk.Checkbutton(
            character_opts, text="Create character list", variable=self.character_list_var, state="disabled")
        self.character_list_check.pack(side="left")
        self._add_help_label(
            character_opts,
            "(set Content to Fiction or Nonfiction to enable — produces a guide to the key "
            "people (characters in fiction; real figures, subjects, or sources in nonfiction) "
            "and their roles, built from brief notes gathered as each section is processed, "
            "plus one extra step at the end that merges them into a full-book write-up)")
        self.clear_char_list_btn = ttk.Button(
            character_opts, text="Clear character list", command=self._on_clear_character_list)
        self.clear_char_list_btn.pack(side="left", padx=(8, 0))
        self.content_type_var.trace_add("write", self._on_content_type_changed)

        # --- Estimated cost (rough; updates live as sections/options change) ---
        estimate_row = ttk.Frame(self)
        estimate_row.pack(fill="x", **pad)
        self.cost_estimate_var = tk.StringVar(value="")
        ttk.Label(estimate_row, textvariable=self.cost_estimate_var, style="Muted.TLabel").pack(side="left")

        # Recompute the estimate whenever anything that affects it changes —
        # this is pure arithmetic over data we already have, so it's cheap to
        # call often. (Section check/uncheck is handled where those happen,
        # since tk.BooleanVar/StringVar traces don't cover the section tree.)
        for _opt_var in (self.summary_var, self.flashcards_var, self.discussion_var,
                         self.character_list_var, self.rolling_context_var):
            _opt_var.trace_add("write", self._on_estimate_inputs_changed)

        # --- Action row ---
        actions = ttk.Frame(self)
        actions.pack(fill="x", **pad)
        self.split_btn = ttk.Button(actions, text="1. Split into sections",
                                    command=self._on_split, state="disabled")
        self.split_btn.pack(side="left")
        self.generate_btn = ttk.Button(actions, text="2. Generate for checked sections",
                                       command=self._on_generate, state="disabled")
        self.generate_btn.pack(side="left", padx=8)
        self.stop_btn = ttk.Button(actions, text="Stop", command=self._on_stop, state="disabled")
        self.stop_btn.pack(side="left")

        self.progress = ttk.Progressbar(actions, mode="determinate", length=240)
        self.progress.pack(side="right", padx=8)
        self.progress_label = ttk.Label(actions, text="")
        self.progress_label.pack(side="right")
        # Elapsed time + ETA, live during a generation run (see _tick_timer /
        # _on_generate / _poll_queue) — sits just to the left of the progress
        # label so the two read together as one status cluster.
        self.time_label = ttk.Label(actions, text="", style="Muted.TLabel")
        self.time_label.pack(side="right", padx=(0, 10))

        # Subtle divider between the "options + actions" group above and the
        # section list / result viewer below — purely visual, no functional
        # role. (Packed in normal top-down order, so it lands here visually
        # regardless of the bottom-anchored status/export row created next.)
        ttk.Separator(self, orient="horizontal").pack(fill="x", padx=8, pady=(2, 4))

        # --- Status + export row: anchored to the bottom edge of the window
        # (packed with side="bottom" *before* the expanding body pane below
        # claims space) so they always stay visible — the section list/result
        # panes shrink and scroll instead of pushing these out of view when
        # the window gets short. ---
        self.status_var = tk.StringVar(value="Open an ebook (.txt, .md, or .epub) to begin.")
        ttk.Label(self, textvariable=self.status_var, style="Muted.TLabel").pack(
            side="bottom", anchor="w", padx=8, pady=(0, 6))

        bottom = ttk.Frame(self)
        bottom.pack(fill="x", side="bottom", **pad)
        self.export_csv_btn = ttk.Button(bottom, text="Export flashcards as CSV (Anki)",
                                         command=self._on_export_csv, state="disabled")
        self.export_csv_btn.pack(side="left")
        self.export_md_btn = ttk.Button(bottom, text="Export summaries as Markdown",
                                        command=self._on_export_md, state="disabled")
        self.export_md_btn.pack(side="left", padx=8)
        self.export_docx_btn = ttk.Button(bottom, text="Export summaries as Word (.docx)",
                                          command=self._on_export_docx, state="disabled")
        self.export_docx_btn.pack(side="left")
        self.export_char_notes_btn = ttk.Button(
            bottom, text="Export character notes",
            command=self._on_export_character_notes, state="disabled")
        self.export_char_notes_btn.pack(side="left", padx=(8, 0))
        self.export_context_btn = ttk.Button(
            bottom, text="Export context notes",
            command=self._on_export_context_notes, state="disabled")
        self.export_context_btn.pack(side="left", padx=8)

        # --- Main split view: section list | result viewer ---
        body = ttk.Panedwindow(self, orient="horizontal")
        body.pack(fill="both", expand=True, **pad)

        left = ttk.Frame(body)
        body.add(left, weight=1)

        section_header = ttk.Frame(left)
        section_header.pack(fill="x")
        ttk.Label(section_header, text="Sections").pack(side="left")
        ttk.Label(section_header, text="(check to include in generation; double-click a "
                                       "title to rename it)", style="Help.TLabel").pack(side="left", padx=6)

        section_btns = ttk.Frame(left)
        section_btns.pack(fill="x", pady=(2, 2))
        ttk.Button(section_btns, text="Check all", command=lambda: self._set_all_checked(True)).pack(side="left")
        ttk.Button(section_btns, text="Uncheck all", command=lambda: self._set_all_checked(False)).pack(side="left", padx=6)
        ttk.Button(section_btns, text="Rename…", command=self._on_rename_section).pack(side="left")
        ttk.Button(section_btns, text="Clear result", command=self._on_clear_result).pack(side="left", padx=(6, 0))
        ttk.Button(section_btns, text="Clear all results", command=self._on_clear_all_results).pack(side="left", padx=6)

        merge_btns = ttk.Frame(left)
        merge_btns.pack(fill="x", pady=(0, 4))
        ttk.Label(merge_btns, text="Merge selected:", style="Help.TLabel").pack(side="left")
        ttk.Button(merge_btns, text="↑ with previous",
                   command=lambda: self._merge_with_neighbor("previous")).pack(side="left", padx=(6, 4))
        ttk.Button(merge_btns, text="↓ with next",
                   command=lambda: self._merge_with_neighbor("next")).pack(side="left")

        tree_frame = ttk.Frame(left)
        tree_frame.pack(fill="both", expand=True)
        self.section_tree = ttk.Treeview(
            tree_frame, columns=("check", "title", "words", "status"),
            show="headings", selectmode="browse", height=18,
        )
        self.section_tree.heading("check", text="Use?")
        self.section_tree.heading("title", text="Section")
        self.section_tree.heading("words", text="Words")
        self.section_tree.heading("status", text="")
        self.section_tree.column("check", width=46, anchor="center", stretch=False)
        self.section_tree.column("title", width=210, anchor="w")
        self.section_tree.column("words", width=64, anchor="e", stretch=False)
        self.section_tree.column("status", width=28, anchor="center", stretch=False)

        vsb = ttk.Scrollbar(tree_frame, orient="vertical", command=self.section_tree.yview)
        self.section_tree.configure(yscrollcommand=vsb.set)
        self.section_tree.pack(side="left", fill="both", expand=True)
        vsb.pack(side="right", fill="y")

        self.section_tree.bind("<Button-1>", self._on_tree_click)
        self.section_tree.bind("<Double-Button-1>", self._on_tree_double_click)
        self.section_tree.bind("<<TreeviewSelect>>", self._on_select_section)

        right = ttk.Frame(body)
        body.add(right, weight=3)

        self.result_title = ttk.Label(right, text="", style="Bold.TLabel")
        self.result_title.pack(anchor="w")

        notebook = ttk.Notebook(right)
        notebook.pack(fill="both", expand=True, pady=(6, 0))

        # Summary tab
        summary_frame = ttk.Frame(notebook)
        notebook.add(summary_frame, text="Summary")
        self.summary_text = tk.Text(summary_frame, wrap="word", state="disabled")
        self.summary_text.pack(fill="both", expand=True)
        self._text_widgets.append(self.summary_text)

        # Flashcards tab
        cards_frame = ttk.Frame(notebook)
        notebook.add(cards_frame, text="Flashcards")
        self.cards_text = tk.Text(cards_frame, wrap="word", state="disabled")
        self.cards_text.pack(fill="both", expand=True)
        self._text_widgets.append(self.cards_text)

        # Discussion questions tab
        discussion_frame = ttk.Frame(notebook)
        notebook.add(discussion_frame, text="Discussion questions")
        self.discussion_text = tk.Text(discussion_frame, wrap="word", state="disabled")
        self.discussion_text.pack(fill="both", expand=True)
        self._text_widgets.append(self.discussion_text)

        # Characters tab — book-level (not per-section): shows the same
        # full-book character guide regardless of which section is selected.
        characters_frame = ttk.Frame(notebook)
        notebook.add(characters_frame, text="Characters")
        self.character_text = tk.Text(characters_frame, wrap="word", state="disabled")
        self.character_text.pack(fill="both", expand=True)
        self._text_widgets.append(self.character_text)

        # Section source text tab
        source_frame = ttk.Frame(notebook)
        notebook.add(source_frame, text="Section text")
        self.source_text = tk.Text(source_frame, wrap="word", state="disabled")
        self.source_text.pack(fill="both", expand=True)
        self._text_widgets.append(self.source_text)

    # ------------------------------------------------------------- handlers

    def _on_open_ebook(self):
        path = filedialog.askopenfilename(
            title="Choose an ebook",
            filetypes=[("Ebooks", "*.txt *.md *.markdown *.epub *.pdf"), ("All files", "*.*")],
        )
        if not path:
            return
        self.ebook_path = path
        self.file_label.config(text=os.path.basename(path))

        try:
            title_guess, author_guess = detect_title_author(path)
        except Exception:
            title_guess, author_guess = "", ""
        self.title_var.set(title_guess or os.path.splitext(os.path.basename(path))[0])
        self.author_var.set(author_guess)

        self.sections = []
        self.results = {}
        self.section_checked = {}
        self.character_list = []
        self.character_list_error = None
        self._clear_section_tree()
        self._clear_result_panes()
        self.split_btn.config(state="normal")
        self.generate_btn.config(state="disabled")
        self.export_csv_btn.config(state="disabled")
        self.export_md_btn.config(state="disabled")
        self.export_docx_btn.config(state="disabled")
        self.export_char_notes_btn.config(state="disabled")
        self.export_context_btn.config(state="disabled")
        self.status_var.set(f"Loaded {os.path.basename(path)}. Click 'Split into sections' to continue.")

    def _on_save_key(self):
        key = self.api_key_var.get().strip()
        config.save_api_key(key)
        messagebox.showinfo("Saved", "API key saved locally to ~/.ebook_flashcards/config.json")

    def _on_backend_changed(self, *_args):
        """Show the appropriate credential/model widgets for the selected
        backend, update the cost estimate label, and (for Ollama/Groq) trigger
        an automatic model-list refresh so the dropdown is ready to use."""
        backend = self.backend_var.get()
        # Hide all three backend-specific frames, then show the relevant one.
        self._anthropic_widgets_frame.pack_forget()
        self._ollama_widgets_frame.pack_forget()
        self._groq_widgets_frame.pack_forget()
        if backend == "Ollama (local)":
            self._ollama_widgets_frame.pack(side="left")
            # Auto-populate the model list the first time the user switches
            # to Ollama so they don't have to click Refresh manually.
            if not self.ollama_model_combo["values"]:
                self._refresh_ollama_models()
        elif backend == "Groq":
            self._groq_widgets_frame.pack(side="left")
            # Always try to populate on first switch — _refresh_groq_models
            # shows a "Enter API key first" hint if no key is present yet,
            # and fetches models if one is.
            if not self.groq_model_combo["values"]:
                self._refresh_groq_models()
        else:  # Anthropic API
            self._anthropic_widgets_frame.pack(side="left")
        self._update_cost_estimate()

    def _refresh_ollama_models(self):
        """Query the local Ollama instance for installed models and populate
        the model combobox. Updates the status label with a brief result."""
        self.ollama_status_label.config(text="Checking…")
        self.update_idletasks()  # flush so "Checking…" actually renders
        models, error = get_ollama_models()
        if error or not models:
            msg = "Not reachable" if not models else "No models installed"
            self.ollama_status_label.config(text=f"⚠ {msg}")
            self.ollama_model_combo.config(values=[])
            self.ollama_model_var.set("")
        else:
            self.ollama_model_combo.config(values=models)
            if not self.ollama_model_var.get() or self.ollama_model_var.get() not in models:
                self.ollama_model_var.set(models[0])
            self.ollama_status_label.config(text=f"{len(models)} model(s) found")

    def _refresh_groq_models(self):
        """Query the Groq API for available chat models and populate the model
        combobox. Requires a valid API key to be entered first."""
        api_key = self.groq_api_key_var.get().strip()
        if not api_key:
            self.groq_status_label.config(text="⚠ Enter API key first")
            return
        self.groq_status_label.config(text="Checking…")
        self.update_idletasks()
        models, error = get_groq_models(api_key)
        if error or not models:
            msg = (error or "No models found")[:80]
            self.groq_status_label.config(text=f"⚠ {msg}")
            self.groq_model_combo.config(values=[])
            self.groq_model_var.set("")
        else:
            self.groq_model_combo.config(values=models)
            if not self.groq_model_var.get() or self.groq_model_var.get() not in models:
                # Prefer a capable Llama model if one's available; else first.
                preferred = next(
                    (m for m in models if "llama" in m.lower() and "70b" in m.lower()), None
                )
                self.groq_model_var.set(preferred or models[0])
            self.groq_status_label.config(text=f"{len(models)} model(s) found")

    def _on_save_groq_key(self):
        key = self.groq_api_key_var.get().strip()
        config.save_groq_api_key(key)
        messagebox.showinfo("Saved", "Groq API key saved locally to ~/.ebook_flashcards/config.json")
        # Refresh the model list immediately so the user doesn't have to
        # manually click ↺ after saving a new key.
        self._refresh_groq_models()

    def _on_content_type_changed(self, *_args):
        """The character-list feature works for both fiction (main characters)
        and nonfiction (the real people — historical figures, subjects,
        sources — the book centers on), so keep its checkbox enabled for
        either. It stays disabled only for Auto-detect, since the prompts it
        feeds need to know up front which framing to use and that isn't
        decided until generation actually starts."""
        if CONTENT_TYPE_OPTIONS.get(self.content_type_var.get()) in ("fiction", "nonfiction"):
            self.character_list_check.config(state="normal")
        else:
            self.character_list_var.set(False)
            self.character_list_check.config(state="disabled")

    # --- live token/cost estimate ------------------------------------------

    def _on_estimate_inputs_changed(self, *_args):
        self._update_cost_estimate()

    def _update_cost_estimate(self):
        """Recompute the rough token-usage / USD estimate for a "Generate" run
        with the current settings. Pure arithmetic over data already on hand
        (checked sections' character counts + which content types are ticked)
        — no API calls — so any handler that changes those inputs can call
        this freely to keep the readout live."""
        if not hasattr(self, "cost_estimate_var"):
            return  # called during layout construction, before the var exists
        if not self.sections:
            self.cost_estimate_var.set("")
            return

        # Non-Anthropic backends: skip the per-token arithmetic.
        if getattr(self, "backend_var", None):
            backend = self.backend_var.get()
            if backend == "Ollama (local)":
                checked = self._checked_indices()
                label = "free (local model — no API charges)"
                suffix = f"{len(checked)} section(s) checked." if checked else "Check at least one section."
                self.cost_estimate_var.set(f"Cost: {label}. {suffix}")
                return
            if backend == "Groq":
                checked = self._checked_indices()
                label = "low (Groq pricing — see groq.com/pricing)"
                suffix = f"{len(checked)} section(s) checked." if checked else "Check at least one section."
                self.cost_estimate_var.set(f"Cost: {label}. {suffix}")
                return

        char_counts = [self.sections[i].char_count for i in self._checked_indices()]
        estimate = estimate_run_cost(
            char_counts,
            want_summary=self.summary_var.get(),
            want_flashcards=self.flashcards_var.get(),
            want_discussion=self.discussion_var.get(),
            want_character_list=self.character_list_var.get(),
            want_context_digest=self.rolling_context_var.get(),
            # Chapter continuity (avoiding repeated flashcards/questions across
            # a chapter's split parts) is always on — see _generate_worker. It
            # rides along on calls already being made (no extra API calls), so
            # there's no reason to make it optional; the estimator still takes
            # a flag for testability and to mirror generate_section_content's
            # shape, but the GUI always requests it.
            want_chapter_continuity=True,
        )
        if estimate.total_tokens == 0:
            self.cost_estimate_var.set(
                "Estimated cost: — (check at least one section, and at least "
                "one of Summary / Flashcards / Discussion questions)"
            )
            return

        self.cost_estimate_var.set(
            f"Estimated for this run: ~{estimate.input_tokens:,} input + "
            f"~{estimate.output_tokens:,} output tokens ≈ ${estimate.usd:,.2f} "
            f"— a rough approximation; actual usage varies with the material "
            f"and the model's responses (see Notes & tips in the README)."
        )

    def _on_split(self):
        if not self.ebook_path:
            return
        try:
            self.sections = split_ebook(self.ebook_path, max_chars=self.max_chars_var.get())
        except Exception as e:
            messagebox.showerror("Couldn't split ebook", str(e))
            return
        self.results = {}
        self.section_checked = {i: True for i in range(len(self.sections))}
        self.character_list = []
        self.character_list_error = None
        self._populate_section_tree()
        self._clear_result_panes()
        self._update_cost_estimate()
        if self.sections:
            self.generate_btn.config(state="normal")
            self.status_var.set(
                f"Split into {len(self.sections)} section(s). All are checked by default — "
                f"uncheck any you want to skip (e.g. indexes, \"praise for\" pages), "
                f"then click 'Generate for checked sections'."
            )
        else:
            self.status_var.set("No sections were detected — the file may be empty or in an unexpected format.")

    # --- section tree (checkbox list) -------------------------------------

    def _clear_section_tree(self):
        for iid in self.section_tree.get_children():
            self.section_tree.delete(iid)

    def _populate_section_tree(self):
        self._clear_section_tree()
        for idx, sec in enumerate(self.sections):
            self.section_tree.insert(
                "", "end", iid=str(idx),
                values=(CHECKED if self.section_checked.get(idx, True) else UNCHECKED,
                        sec.title, sec.word_count, ""),
            )

    def _set_all_checked(self, checked: bool):
        for idx in range(len(self.sections)):
            self.section_checked[idx] = checked
            self.section_tree.set(str(idx), "check", CHECKED if checked else UNCHECKED)
        self._update_cost_estimate()

    def _on_tree_click(self, event):
        if self.section_tree.identify_region(event.x, event.y) != "cell":
            return
        col = self.section_tree.identify_column(event.x)
        row = self.section_tree.identify_row(event.y)
        if not row:
            return
        if col == "#1":  # the "Use?" checkbox column
            idx = int(row)
            new_state = not self.section_checked.get(idx, True)
            self.section_checked[idx] = new_state
            self.section_tree.set(row, "check", CHECKED if new_state else UNCHECKED)
            self._update_cost_estimate()
            # Don't let this click also change the row selection/preview
            return "break"

    def _on_tree_double_click(self, event):
        """Double-clicking a section's title opens the rename prompt for that
        row directly — the quickest path for the common case of fixing one
        mislabeled section as you spot it (see _on_rename_section)."""
        if self.section_tree.identify_region(event.x, event.y) != "cell":
            return
        col = self.section_tree.identify_column(event.x)
        row = self.section_tree.identify_row(event.y)
        if not row or col != "#2":  # the "Section" (title) column
            return
        self.section_tree.selection_set(row)
        self._on_rename_section(int(row))
        return "break"

    def _on_rename_section(self, idx: int | None = None):
        """Manually override a section's title — e.g. when the parser gets
        some sections wrong (a run of misdetected front matter labeled
        "Section 5" that's really "Chapter 1") while getting later ones right
        (genuine "Chapter 2", "Chapter 3", …). A plain section is renamed on
        its own with no side effects — no renumbering, no inferring or
        cascading a pattern onto its neighbors, unlike merging (which *does*
        renumber sibling "(part X of Y)" labels, because collapsing two parts
        makes that a structural necessity).

        If the section IS one of a split chapter's "(part X of Y)" pieces,
        though, you're offered a choice: retitle just this one piece (handy
        for a one-off typo), or retitle the whole chapter at once — which
        relabels every sibling part to "{new title} (part N of M)", preserving
        each one's part number. Doing the latter is also what keeps "avoid
        repeating flashcards/questions across chapter parts" (see
        ChapterContinuityTracker) working smoothly afterward: that feature
        groups parts purely by re-parsing "(part X of Y)" titles at generation
        time, so renamed parts that still share a consistent base title and
        numbering continue to be recognized as one chapter — and parts you
        retitle into something that no longer matches that pattern (or that
        ends up with a different base title than its siblings) simply stop
        being grouped with them, exactly as if the parser had labeled them
        that way to begin with. No special-casing needed here for that."""
        if idx is None:
            sel = self.section_tree.selection()
            if not sel:
                messagebox.showinfo("Select a section",
                                    "Click a section in the list first, then click Rename.")
                return
            idx = int(sel[0])
        sec = self.sections[idx]

        m = PART_RE.match(sec.title)
        siblings: list[int] = []
        if m:
            base_title, total = m.group(1), m.group(3)
            siblings = [
                i for i, s in enumerate(self.sections)
                if (mm := PART_RE.match(s.title)) and mm.group(1) == base_title and mm.group(3) == total
            ]

        if len(siblings) > 1:
            choice = messagebox.askyesnocancel(
                "Rename one part or the whole chapter?",
                f"“{sec.title}” is one of {len(siblings)} parts of a chapter "
                f"currently titled “{base_title}”.\n\n"
                f"Yes — rename the WHOLE chapter (relabels all {len(siblings)} "
                f"parts to “<new title> (part N of {total})”, keeping their "
                f"numbering)\n"
                f"No — rename just this ONE part\n"
                f"Cancel — don't rename anything"
            )
            if choice is None:
                return
            if choice:
                self._rename_chapter_parts(base_title, siblings)
                return
            # else: fall through to the single-section rename below

        new_title = simpledialog.askstring(
            "Rename section", "New title:", initialvalue=sec.title, parent=self)
        if new_title is None:
            return  # cancelled
        new_title = new_title.strip()
        if not new_title or new_title == sec.title:
            return

        self.sections[idx] = Section(title=new_title, text=sec.text)
        self.section_tree.set(str(idx), "title", new_title)
        if self.section_tree.selection() == (str(idx),):
            self.result_title.config(text=new_title)
        self.status_var.set(f"Renamed “{sec.title}” to “{new_title}”.")

    def _rename_chapter_parts(self, old_base_title: str, sibling_indices: list[int]):
        """Retitle every sibling "(part X of Y)" section of a chapter at once,
        substituting a new chapter name while preserving each part's "(part N
        of M)" suffix — e.g. renaming "Section 5 (part 1 of 2)" /  "Section 5
        (part 2 of 2)" to "Chapter 1" produces "Chapter 1 (part 1 of 2)" /
        "Chapter 1 (part 2 of 2)". Called from _on_rename_section once the
        user has confirmed they want the whole-chapter option."""
        new_base = simpledialog.askstring(
            "Rename chapter",
            f"New title for all {len(sibling_indices)} parts of this chapter\n"
            f"(their “(part N of M)” labels are kept — only the chapter name "
            f"itself changes):",
            initialvalue=old_base_title, parent=self)
        if new_base is None:
            return  # cancelled
        new_base = new_base.strip()
        if not new_base or new_base == old_base_title:
            return

        for i in sibling_indices:
            old_sec = self.sections[i]
            mm = PART_RE.match(old_sec.title)
            new_title = f"{new_base} (part {mm.group(2)} of {mm.group(3)})"
            self.sections[i] = Section(title=new_title, text=old_sec.text)
            self.section_tree.set(str(i), "title", new_title)
            if self.section_tree.selection() == (str(i),):
                self.result_title.config(text=new_title)
        self.status_var.set(
            f"Renamed all {len(sibling_indices)} parts of “{old_base_title}” to “{new_base}”."
        )

    def _checked_indices(self) -> list[int]:
        return [i for i in range(len(self.sections)) if self.section_checked.get(i, True)]

    def _restore_status_marks(self):
        for idx, result in self.results.items():
            self.section_tree.set(str(idx), "status", "✓" if not result.error else "⚠")

    # --- merging adjacent sections ------------------------------------------

    def _merged_title_for(self, sec_a: Section, sec_b: Section) -> tuple[str, str | None, int | None]:
        """Decide the merged section's title.

        Special-cases the parser's "(part X of Y)" labels for subdivided long
        sections: merging two adjacent sibling parts of the same chapter
        collapses the part count by one, so titles need renumbering to stay
        sequential — e.g. merging "Chapter 1 (part 1 of 2)" with "Chapter 1
        (part 2 of 2)" should simply become "Chapter 1", and merging parts 1
        and 2 of 3 should leave the former "part 3 of 3" relabeled "part 2 of
        2".

        Returns (merged_title, sibling_base_title_or_None, old_total_or_None).
        The caller passes the latter two to _renumber_sibling_parts (after the
        merge itself has gone through) to fix up any remaining siblings.
        """
        m_a = PART_RE.match(sec_a.title)
        m_b = PART_RE.match(sec_b.title)
        if m_a and m_b and m_a.group(1) == m_b.group(1) and m_a.group(3) == m_b.group(3):
            base = m_a.group(1)
            old_total = int(m_a.group(3))
            new_total = old_total - 1
            title = base if new_total <= 1 else f"{base} (part 1 of {new_total})"
            return title, base, old_total
        return sec_a.title, None, None

    def _renumber_sibling_parts(self, base_title: str, new_total: int):
        """After collapsing two sibling "(part X of Y)" sections into one,
        relabel the surviving sections that belong to the same chapter as
        1..new_total in order — or drop the suffix entirely once only one
        remains, since at that point it's just the whole chapter again."""
        matches = []
        for i, sec in enumerate(self.sections):
            m = PART_RE.match(sec.title)
            if (m and m.group(1) == base_title) or sec.title == base_title:
                matches.append(i)
        for seq, i in enumerate(matches, start=1):
            sec = self.sections[i]
            new_title = base_title if new_total <= 1 else f"{base_title} (part {seq} of {new_total})"
            if new_title != sec.title:
                self.sections[i] = Section(title=new_title, text=sec.text)

    def _on_clear_result(self):
        """Remove the stored result for the selected section so Generate will
        re-process it on the next run."""
        sel = self.section_tree.selection()
        if not sel:
            messagebox.showinfo("Select a section",
                                "Click a section in the list first, then click Clear result.")
            return
        idx = int(sel[0])
        if idx not in self.results:
            self.status_var.set("That section has no result to clear.")
            return
        del self.results[idx]
        self.section_tree.set(str(idx), "status", "")
        self._clear_result_panes()
        self._on_select_section()
        self.status_var.set(f"Cleared result for '{self.sections[idx].title}'. "
                            f"It will be re-generated on the next run.")

    def _on_clear_all_results(self):
        """Remove all stored results so Generate will re-process every checked
        section from scratch — useful when switching to a different model."""
        if not self.results:
            self.status_var.set("No results to clear.")
            return
        n = len(self.results)
        if not messagebox.askyesno(
            "Clear all results",
            f"Clear the generated content for all {n} section(s)?\n\n"
            f"This cannot be undone. The sections themselves are not affected — "
            f"only the generated summaries, flashcards, and notes are removed."
        ):
            return
        self.results = {}
        self.character_list = []
        self.character_list_error = None
        for idx in range(len(self.sections)):
            self.section_tree.set(str(idx), "status", "")
        self._clear_result_panes()
        self.export_csv_btn.config(state="disabled")
        self.export_md_btn.config(state="disabled")
        self.export_docx_btn.config(state="disabled")
        self.export_char_notes_btn.config(state="disabled")
        self.export_context_btn.config(state="disabled")
        self.status_var.set(f"Cleared results for {n} section(s).")

    def _on_clear_character_list(self):
        """Clear the consolidated character list so the next Generate run
        rebuilds it from scratch from all character notes."""
        if not self.character_list and not self.character_list_error:
            self.status_var.set("No character list to clear.")
            return
        self.character_list = []
        self.character_list_error = None
        self._render_character_list()
        self.status_var.set("Character list cleared — it will be rebuilt on the next Generate run.")

    def _merge_with_neighbor(self, direction: str):
        sel = self.section_tree.selection()
        if not sel:
            messagebox.showinfo("Select a section",
                                "Click a section in the list first, then choose which neighbor to merge it with.")
            return
        idx = int(sel[0])
        if direction == "previous":
            if idx == 0:
                messagebox.showinfo("Can't merge", "This is already the first section.")
                return
            a, b = idx - 1, idx
        else:
            if idx == len(self.sections) - 1:
                messagebox.showinfo("Can't merge", "This is already the last section.")
                return
            a, b = idx, idx + 1

        sec_a, sec_b = self.sections[a], self.sections[b]
        merged_title, sibling_base, sibling_total = self._merged_title_for(sec_a, sec_b)
        merged_words = sec_a.word_count + sec_b.word_count
        if not messagebox.askyesno(
            "Merge sections",
            f"Merge “{sec_b.title}” into “{sec_a.title}”?\n\n"
            f"The combined section will be titled “{merged_title}” and be "
            f"about {merged_words} words. Any already-generated results for "
            f"either section will be cleared for the merged section (you can "
            f"regenerate it afterward)."
        ):
            return

        merged = Section(title=merged_title, text=sec_a.text.rstrip() + "\n\n" + sec_b.text.lstrip())
        old_count = len(self.sections)
        self.sections = self.sections[:a] + [merged] + self.sections[b + 1:]

        new_checked: dict[int, bool] = {}
        new_results: dict[int, SectionResult] = {}
        for old_idx in range(old_count):
            if old_idx in (a, b):
                continue
            new_idx = old_idx if old_idx < a else old_idx - 1
            new_checked[new_idx] = self.section_checked.get(old_idx, True)
            if old_idx in self.results:
                new_results[new_idx] = self.results[old_idx]
        new_checked[a] = self.section_checked.get(a, True) or self.section_checked.get(b, True)

        self.section_checked = new_checked
        self.results = new_results

        # If the merged pair were sibling "(part X of Y)" sections, renumber
        # whatever's left of that chapter so the labels stay sequential and
        # accurate (or drop the suffix entirely if only one part now remains).
        if sibling_base is not None:
            self._renumber_sibling_parts(sibling_base, sibling_total - 1)

        self._populate_section_tree()
        self._restore_status_marks()
        self._update_cost_estimate()
        self.section_tree.selection_set(str(a))
        self.section_tree.see(str(a))
        self._on_select_section()
        merged_now = self.sections[a]
        self.status_var.set(
            f"Merged into “{merged_now.title}” ({merged_now.word_count} words, {merged_now.char_count} chars)."
        )

    # --- result preview ----------------------------------------------------

    def _on_select_section(self, _event=None):
        sel = self.section_tree.selection()
        if not sel:
            return
        idx = int(sel[0])
        sec = self.sections[idx]
        self.result_title.config(text=sec.title)
        self._set_text(self.source_text, sec.text)

        result = self.results.get(idx)
        if result is None:
            placeholder = "(not generated yet)" if self.section_checked.get(idx, True) else "(section unchecked — skipped)"
            self._set_text(self.summary_text, placeholder)
            self._set_text(self.cards_text, placeholder)
            self._set_text(self.discussion_text, placeholder)
        elif result.error:
            self._set_text(self.summary_text, f"Generation failed:\n{result.error}")
            self._set_text(self.cards_text, "")
            self._set_text(self.discussion_text, "")
        else:
            self._set_text(self.summary_text, result.summary or "(summary wasn't requested for this run)")

            card_lines = []
            for n, card in enumerate(result.flashcards, 1):
                card_lines.append(f"{n}. Q: {card.front}\n   A: {card.back}\n")
            self._set_text(self.cards_text, "\n".join(card_lines) or "(flashcards weren't requested for this run)")

            question_lines = [f"{n}. {q}" for n, q in enumerate(result.discussion_questions, 1)]
            self._set_text(self.discussion_text, "\n\n".join(question_lines)
                           or "(discussion questions weren't requested for this run)")

    def _render_character_list(self):
        """Book-level — unlike the other tabs, this doesn't depend on which
        section is selected; it shows the same full-book guide throughout."""
        if self.character_list_error and not self.character_list:
            self._set_text(self.character_text, f"Couldn't build the character list:\n{self.character_list_error}")
            return
        if not self.character_list:
            self._set_text(self.character_text, "(no character list was produced for this run)")
            return
        lines = []
        for character in self.character_list:
            lines.append(character.name)
            lines.append(character.summary)
            lines.append("")
        self._set_text(self.character_text, "\n".join(lines).strip())

    # --- generation ---------------------------------------------------------

    def _on_generate(self):
        if self._generating:
            return

        backend = self.backend_var.get()

        if backend == "Ollama (local)":
            model = self.ollama_model_var.get().strip()
            if not model:
                messagebox.showwarning(
                    "No model selected",
                    "Select an Ollama model first (or click ↺ Refresh models if the list is empty).",
                )
                return
            api_key = ""
            llm_backend = "ollama"
        elif backend == "Groq":
            api_key = self.groq_api_key_var.get().strip()
            if not api_key:
                messagebox.showwarning(
                    "API key needed",
                    "Enter your Groq API key first (and optionally save it).",
                )
                return
            model = self.groq_model_var.get().strip()
            if not model:
                messagebox.showwarning(
                    "No model selected",
                    "Select a Groq model first (or click ↺ Refresh models if the list is empty).",
                )
                return
            llm_backend = "groq"
        else:  # Anthropic API
            api_key = self.api_key_var.get().strip()
            model = DEFAULT_MODEL
            if not api_key:
                messagebox.showwarning(
                    "API key needed",
                    "Enter your Anthropic API key first (and optionally save it).",
                )
                return
            llm_backend = "anthropic"

        if not self.sections:
            return

        checked = self._checked_indices()
        if not checked:
            messagebox.showinfo("Nothing checked", "Check at least one section to generate content for.")
            return

        include_summary = self.summary_var.get()
        include_flashcards = self.flashcards_var.get()
        include_discussion = self.discussion_var.get()
        if not (include_summary or include_flashcards or include_discussion):
            messagebox.showinfo("Nothing to generate",
                                "Check at least one of Summary, Flashcards, or Discussion questions.")
            return
        content_type = CONTENT_TYPE_OPTIONS.get(self.content_type_var.get(), "auto")
        include_character_list = self.character_list_var.get() and content_type in ("fiction", "nonfiction")
        include_rolling_context = self.rolling_context_var.get()

        # Only process sections that don't already have a successful result —
        # this makes every Generate click a "resume/retry" operation: failed
        # or never-generated sections are processed, already-done ones are
        # skipped. Character notes and rolling context accumulated by previous
        # successful sections are carried forward so nothing is lost.
        to_process = [
            idx for idx in checked
            if not (self.results.get(idx) and not self.results[idx].error)
        ]
        n_skip = len(checked) - len(to_process)

        # Reconstruct accumulated character notes and the last good rolling
        # context digest from all previously successful results (regardless of
        # which sections are currently checked), so the new run picks up the
        # full picture from where the last one left off.
        initial_notes: list[tuple[str, list[CharacterNote]]] = [
            (self.sections[idx].title, self.results[idx].character_notes)
            for idx in sorted(self.results.keys())
            if not self.results[idx].error and self.results[idx].character_notes
        ]
        initial_context: str | None = None
        for idx in sorted(self.results.keys()):
            r = self.results[idx]
            if not r.error and r.context_digest:
                initial_context = r.context_digest

        if not to_process:
            self.status_var.set(
                f"All {len(checked)} checked section(s) already have results. "
                f"To re-generate a section, look for ⚠ failures above, or "
                f"split the ebook again to start fresh."
            )
            return

        self._generating = True
        self._stop_requested = False
        self.generate_btn.config(state="disabled")
        self.split_btn.config(state="disabled")
        self.stop_btn.config(state="normal")
        self.progress.config(maximum=len(to_process), value=0)

        # Kick off the live elapsed/ETA readout — see _tick_timer for the
        # "average time per completed section so far" estimate it displays.
        self._gen_start_time = time.monotonic()
        self._gen_completed = 0
        self._gen_eta = None
        self.time_label.config(text="Elapsed 0:00")
        self._tick_timer()

        # Clear status marks only on sections we're about to (re)generate
        for idx in to_process:
            self.section_tree.set(str(idx), "status", "")

        skip_msg = f" ({n_skip} already-done section(s) skipped)" if n_skip else ""
        if include_character_list:
            self._set_text(self.character_text,
                           f"(generating{skip_msg} — brief notes are gathered as each section is "
                           f"processed, then merged into a full write-up in one extra step at the end)")
        else:
            self._set_text(self.character_text,
                           "(character list wasn't requested for this run — check \"Create character "
                           "list\" with Content set to Fiction or Nonfiction)")

        thread = threading.Thread(
            target=self._generate_worker,
            args=(api_key, to_process, include_summary, include_flashcards, include_discussion,
                  content_type, include_character_list, include_rolling_context,
                  llm_backend, model),
            kwargs={"initial_notes": initial_notes, "initial_context": initial_context,
                    "n_skip": n_skip},
            daemon=True,
        )
        thread.start()

    def _tick_timer(self):
        """Refresh the elapsed/ETA readout roughly once a second while a run
        is in progress, then reschedule itself — see _on_generate (which
        kicks this off and sets _gen_start_time) and _poll_queue (which keeps
        _gen_completed current, recomputes _gen_eta each time a new section
        starts, and clears _gen_start_time to stop the loop once the run
        ends).

        _gen_eta only gets a fresh value at recompute time — here we just
        count it down by a second per tick so the display moves smoothly
        without drifting upward between completions (see the _gen_eta
        comment in __init__ for why a live recalculation each tick would do
        that)."""
        if self._gen_start_time is None:
            return
        elapsed = time.monotonic() - self._gen_start_time
        if self._gen_eta is not None:
            self._gen_eta = max(0.0, self._gen_eta - 1)
        self.time_label.config(text=self._format_timer_text(elapsed))
        self.after(1000, self._tick_timer)

    def _format_timer_text(self, elapsed: float) -> str:
        """"Elapsed M:SS" on its own until at least one section has finished
        (there's no ETA yet), then "Elapsed M:SS · About M:SS left"."""
        text = f"Elapsed {self._format_duration(elapsed)}"
        if self._gen_eta is not None:
            text += f" · About {self._format_duration(self._gen_eta)} left"
        return text

    @staticmethod
    def _format_duration(seconds: float) -> str:
        """Render a non-negative duration as "M:SS", switching to "H:MM:SS"
        once it reaches an hour."""
        seconds = max(0, int(seconds))
        hours, rem = divmod(seconds, 3600)
        minutes, secs = divmod(rem, 60)
        if hours:
            return f"{hours}:{minutes:02d}:{secs:02d}"
        return f"{minutes}:{secs:02d}"

    def _on_stop(self):
        self._stop_requested = True
        self.status_var.set("Stopping after the current section finishes…")

    def _generate_worker(self, api_key: str, indices: list[int], include_summary: bool,
                         include_flashcards: bool, include_discussion: bool, content_type: str,
                         include_character_list: bool, include_rolling_context: bool,
                         backend: str = "anthropic", model: str = DEFAULT_MODEL,
                         initial_notes: list | None = None,
                         initial_context: str | None = None,
                         n_skip: int = 0):
        # Seed notes from any previously successful sections so the character
        # list consolidation at the end covers the whole book, not just this run.
        notes_by_section: list[tuple[str, list[CharacterNote]]] = list(initial_notes or [])
        stopped = False

        # Seed rolling context from the last successful section of any previous
        # run, so sections processed in this run receive correct prior context
        # even when earlier sections were already done and skipped.
        prior_context: str | None = initial_context

        # "Avoid repeating across chapter parts" — always on (it rides along
        # on the calls already being made, with no extra API calls, so there's
        # no real reason to ever turn it off; unlike the optional whole-book
        # recap above, it needs no checkbox). The tracker recognizes
        # "(part N of M)" titles, hands back what earlier parts of the SAME
        # chapter have already produced, and is a complete no-op for any
        # section that isn't part of a split chapter — see
        # ChapterContinuityTracker for the full rationale.
        chapter_tracker = ChapterContinuityTracker()

        for n, idx in enumerate(indices):
            if self._stop_requested:
                stopped = True
                break
            sec = self.sections[idx]
            self._work_queue.put(("progress", (n, len(indices), sec.title)))

            chapter_fronts, chapter_questions = chapter_tracker.context_for(sec.title)

            result = generate_section_content(
                api_key, sec.title, sec.text,
                include_summary=include_summary,
                include_flashcards=include_flashcards,
                include_discussion=include_discussion,
                include_character_notes=include_character_list,
                include_context_digest=include_rolling_context,
                prior_context=prior_context,
                prior_chapter_flashcard_fronts=chapter_fronts,
                prior_chapter_discussion_questions=chapter_questions,
                content_type=content_type,
                backend=backend,
                model=model,
            )
            self._work_queue.put(("result", (idx, result)))
            if include_character_list and not result.error and result.character_notes:
                notes_by_section.append((sec.title, result.character_notes))
            if include_rolling_context and not result.error and result.context_digest:
                # Carry the freshly-updated recap forward to the next section.
                # If this section errored or produced no digest, keep using the
                # last good one rather than breaking the chain.
                prior_context = result.context_digest
            if not result.error:
                # Fold this part's actual flashcards/questions into the running
                # chapter-scoped tally so later parts of the same chapter are
                # told about them. A no-op if this section isn't a chapter part
                # (or belongs to a chapter the tracker has already moved past).
                chapter_tracker.record(
                    sec.title,
                    [card.front for card in result.flashcards],
                    list(result.discussion_questions),
                )

        if include_character_list and notes_by_section:
            self._work_queue.put(("character_list_started", None))
            characters, char_error = consolidate_character_list(
                api_key, self._display_book_title(), notes_by_section,
                model=model, backend=backend,
            )
            self._work_queue.put(("character_list", (characters, char_error)))
        elif include_character_list:
            self._work_queue.put((
                "character_list",
                ([], "No checked sections produced character notes (try checking more sections, "
                     "or generating again if some failed)."),
            ))

        self._work_queue.put(("stopped" if stopped else "done", None))

    def _poll_queue(self):
        try:
            while True:
                kind, payload = self._work_queue.get_nowait()
                if kind == "progress":
                    n, total, title = payload
                    self.progress.config(value=n)
                    self.progress_label.config(text=f"Processing {n + 1}/{total}: {title}")
                    # n sections finished before this one started. Recompute
                    # the ETA right here, at the moment of completion — as
                    # "average time per completed section so far" × sections
                    # remaining — and let _tick_timer count it down by a
                    # second per tick from here until the next completion
                    # lands a fresh number (see _gen_eta comment in __init__).
                    self._gen_completed = n
                    if n > 0 and total > n and self._gen_start_time is not None:
                        avg = (time.monotonic() - self._gen_start_time) / n
                        self._gen_eta = avg * (total - n)
                    else:
                        self._gen_eta = None
                elif kind == "result":
                    idx, result = payload
                    self.results[idx] = result
                    mark = "✓" if not result.error else "⚠"
                    self.section_tree.set(str(idx), "status", mark)
                elif kind == "character_list_started":
                    self.progress_label.config(text="All sections done — building character list…")
                elif kind == "character_list":
                    characters, char_error = payload
                    self.character_list = characters
                    self.character_list_error = char_error
                    self._render_character_list()
                elif kind in ("done", "stopped"):
                    # Freeze the readout on the final elapsed time and stop
                    # the self-rescheduling _tick_timer loop (it bails out as
                    # soon as _gen_start_time is None).
                    if self._gen_start_time is not None:
                        elapsed = time.monotonic() - self._gen_start_time
                        self.time_label.config(text=f"Elapsed {self._format_duration(elapsed)}")
                        self._gen_start_time = None
                        self._gen_eta = None
                    if kind == "done":
                        self.progress.config(value=self.progress["maximum"])
                        self.progress_label.config(text="Done.")
                    else:
                        self.progress_label.config(text="Stopped.")
                    self._generating = False
                    self.generate_btn.config(state="normal")
                    self.split_btn.config(state="normal")
                    self.stop_btn.config(state="disabled")
                    if any(r.flashcards for r in self.results.values()):
                        self.export_csv_btn.config(state="normal")
                    if self.results:
                        self.export_md_btn.config(state="normal")
                        self.export_docx_btn.config(state="normal")
                    if any(r.character_notes for r in self.results.values() if not r.error):
                        self.export_char_notes_btn.config(state="normal")
                    if any(r.context_digest for r in self.results.values() if not r.error):
                        self.export_context_btn.config(state="normal")
                    n_ok = sum(1 for r in self.results.values() if not r.error)
                    n_err = sum(1 for r in self.results.values() if r.error)
                    msg = f"Generated content for {n_ok} section(s)."
                    if n_err:
                        msg += f" {n_err} failed — select a marked (⚠) section to see the error."
                    self.status_var.set(msg)
                    self._on_select_section()
        except queue.Empty:
            pass
        self.after(120, self._poll_queue)

    # --- export --------------------------------------------------------------

    def _export_basename(self) -> str:
        """Filename stem derived from the (editable) title/author fields."""
        title = _sanitize_filename_part(self.title_var.get().strip()) or "ebook"
        author = _sanitize_filename_part(self.author_var.get().strip())
        return f"{title}_by_{author}" if author else title

    def _display_book_title(self) -> str:
        return self.title_var.get().strip() or "Ebook"

    def _on_export_csv(self):
        if not self.results:
            return
        path = filedialog.asksaveasfilename(
            title="Export flashcards as CSV",
            defaultextension=".csv",
            initialfile=f"{self._export_basename()}_flashcards.csv",
            filetypes=[("CSV", "*.csv")],
        )
        if not path:
            return
        ordered = [self.results[i] for i in sorted(self.results) if not self.results[i].error]
        title = self._display_book_title()
        count = export_flashcards_csv(ordered, path, book_title=title)
        message = (f"Wrote {count} flashcard(s) to:\n{path}\n\n"
                   f"In Anki: File > Import, then map columns to Front / Back / Tags "
                   f"(note type: Basic).")

        # Cloze-deletion cards (the {{c1::...}} fill-in-the-blank style) need
        # Anki's Cloze note type, which expects different fields than Basic —
        # so they can't share one CSV/import pass. Write them to a sibling
        # file alongside the one the user chose, only if any were generated.
        cloze_count = count_cloze_flashcards(ordered)
        if cloze_count:
            base, ext = os.path.splitext(path)
            cloze_path = f"{base}_cloze{ext or '.csv'}"
            export_cloze_flashcards_csv(ordered, cloze_path, book_title=title)
            message += (f"\n\nAlso wrote {cloze_count} cloze-deletion card(s) to a "
                        f"separate file:\n{cloze_path}\n\n"
                        f"Import this one separately with note type: Cloze, mapping "
                        f"columns to Text / Back Extra / Tags — Anki only renders "
                        f"the {{{{c1::...}}}} blanks correctly with that note type.")

        messagebox.showinfo("Exported", message)

    def _on_export_md(self):
        if not self.results:
            return
        path = filedialog.asksaveasfilename(
            title="Export summaries as Markdown",
            defaultextension=".md",
            initialfile=f"{self._export_basename()}_study_guide.md",
            filetypes=[("Markdown", "*.md")],
        )
        if not path:
            return
        ordered = [self.results[i] for i in sorted(self.results)]
        export_summaries_markdown(
            ordered, path,
            book_title=self._display_book_title(),
            character_list=self.character_list or None,
        )
        messagebox.showinfo("Exported", f"Wrote study guide to:\n{path}")

    def _on_export_docx(self):
        if not self.results:
            return
        path = filedialog.asksaveasfilename(
            title="Export summaries as Word document",
            defaultextension=".docx",
            initialfile=f"{self._export_basename()}_study_guide.docx",
            filetypes=[("Word document", "*.docx")],
        )
        if not path:
            return
        ordered = [self.results[i] for i in sorted(self.results)]
        try:
            export_summaries_docx(
                ordered, path,
                book_title=self._display_book_title(),
                character_list=self.character_list or None,
            )
        except RuntimeError as e:
            messagebox.showerror("Couldn't export", str(e))
            return
        messagebox.showinfo("Exported", f"Wrote study guide to:\n{path}")

    def _on_export_character_notes(self):
        """Export the raw per-section character notes as Markdown. These are
        the brief observations gathered during generation — the 'raw material'
        that the AI uses to build the full character list. Useful for seeing
        exactly what was noted about each character in each section, or for
        continuing work in another tool."""
        sections_with_notes = [
            (self.sections[idx].title, self.results[idx].character_notes)
            for idx in sorted(self.results.keys())
            if not self.results[idx].error and self.results[idx].character_notes
        ]
        if not sections_with_notes:
            messagebox.showinfo("Nothing to export",
                                "No character notes have been generated yet. Enable "
                                "'Create character list' with Content set to Fiction or "
                                "Nonfiction, then generate.")
            return
        path = filedialog.asksaveasfilename(
            title="Export character notes as Markdown",
            defaultextension=".md",
            initialfile=f"{self._export_basename()}_character_notes.md",
            filetypes=[("Markdown", "*.md")],
        )
        if not path:
            return
        book = self._display_book_title()
        lines = [f"# Character Notes — {book}\n",
                 "_Per-section observations gathered during generation. "
                 "These were used to build the full character list._\n"]
        for sec_title, notes in sections_with_notes:
            lines.append(f"\n## {sec_title}\n")
            for note in notes:
                lines.append(f"**{note.name}**: {note.note}\n")
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        messagebox.showinfo("Exported", f"Wrote character notes to:\n{path}")

    def _on_export_context_notes(self):
        """Export the per-section rolling context digests as Markdown. These
        are the 'story so far' summaries produced by each section and passed
        forward to the next — useful for reviewing how the narrative was
        understood at each point, or for continuing a run with a different
        tool or model."""
        sections_with_context = [
            (self.sections[idx].title, self.results[idx].context_digest)
            for idx in sorted(self.results.keys())
            if not self.results[idx].error and self.results[idx].context_digest
        ]
        if not sections_with_context:
            messagebox.showinfo("Nothing to export",
                                "No context notes have been generated yet. Enable "
                                "'Carry story context forward' before generating.")
            return
        path = filedialog.asksaveasfilename(
            title="Export context notes as Markdown",
            defaultextension=".md",
            initialfile=f"{self._export_basename()}_context_notes.md",
            filetypes=[("Markdown", "*.md")],
        )
        if not path:
            return
        book = self._display_book_title()
        lines = [f"# Rolling Context Notes — {book}\n",
                 "_The 'story so far' digest produced after each section and "
                 "passed forward to the next as background context._\n"]
        for sec_title, digest in sections_with_context:
            lines.append(f"\n## {sec_title}\n")
            lines.append(digest)
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        messagebox.showinfo("Exported", f"Wrote context notes to:\n{path}")

    # ----------------------------------------------------------------- util

    def _clear_result_panes(self):
        self.result_title.config(text="")
        for widget in (self.summary_text, self.cards_text, self.discussion_text,
                       self.character_text, self.source_text):
            self._set_text(widget, "")

    @staticmethod
    def _set_text(widget: tk.Text, content: str):
        widget.config(state="normal")
        widget.delete("1.0", "end")
        widget.insert("1.0", content)
        widget.config(state="disabled")


if __name__ == "__main__":
    app = EbookFlashcardsApp()
    app.mainloop()
