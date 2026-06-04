# Pebble

A light markdown editor for macOS.

Pebble is a small, fast desktop markdown editor built for people who edit a lot of markdown on a small screen. It gives you in-place WYSIWYG editing (no clutter of raw syntax), plus source and split-preview modes, all in a tidy tabbed window.

## Features

- **Three view modes**: WYSIWYG (Typora-style), raw Source, and Split (source + live preview)
- **Tabs**: open and edit multiple files at once
- **Outline** sidebar for quick heading navigation
- **Find and replace**
- **Frontmatter** editing box (YAML `---` blocks) kept separate from the body in WYSIWYG mode
- **Syntax highlighting**, **Mermaid** diagrams, and **task lists** in preview
- **Export** to HTML and **print / save as PDF**
- **Autosave** and **session restore** (reopens your tabs)
- **Drag and drop** files to open them
- Status bar with word and character counts

## Run from source

Requirements: Node.js and Rust (via [rustup](https://rustup.rs)).

```sh
npm install
npm run tauri dev
```

## Build a local app

```sh
npm run tauri build
```

The packaged app and installer land in `src-tauri/target/release/bundle/` (`Pebble.app` and a `.dmg`).

Because the app is not signed with a paid Apple Developer certificate, the first time you open it macOS Gatekeeper may warn you. Right-click the app and choose **Open**, then confirm. You only need to do this once.

## Stack

Tauri v2 (Rust shell) + Vite + vanilla JS, with [@milkdown/crepe](https://milkdown.dev) for WYSIWYG editing.

## License

MIT. See [LICENSE](LICENSE).
