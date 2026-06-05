<h3 align="center">
  <img src="assets/logo.png" width="120" align="center" alt="Pebble logo" />
  &nbsp;
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/wordmark-dark.png" />
    <img src="assets/wordmark-light.png" height="60" align="center" alt="Pebble" />
  </picture>
</h3>

<p align="center">A light markdown editor for macOS</p>

<p align="center">
  <a href="https://xinwu5.github.io/pebble/">Website</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/xinwu5/pebble/releases/latest">Download</a>
</p>

---

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

## Install

[Download the latest `.dmg`](https://github.com/xinwu5/pebble/releases/latest) (Apple Silicon), open it, and drag **Pebble** into Applications. On first launch, right-click the app and choose **Open**.

If macOS says Pebble is **"damaged"**, that is the download quarantine on an unsigned free app. Clear it once in Terminal, then open normally:

```sh
xattr -dr com.apple.quarantine /Applications/Pebble.app
```

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

Because the app is not signed with a paid Apple Developer certificate, the first time you open it macOS Gatekeeper may warn you. Right-click the app and choose **Open**, then confirm. If it reports the app is "damaged", run `xattr -dr com.apple.quarantine /Applications/Pebble.app` once.

## Stack

Tauri v2 (Rust shell) + Vite + vanilla JS, with [@milkdown/crepe](https://milkdown.dev) for WYSIWYG editing.

## License

MIT. See [LICENSE](LICENSE).
