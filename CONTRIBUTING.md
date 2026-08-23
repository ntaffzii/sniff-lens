# 🤝 Contributing to Network Image Sniffer & AI Toolkit

Thank you for your interest in contributing to **Network Image Sniffer & AI Toolkit (SniffLens)**! We welcome contributions from developers of all skill levels.

---

## 🛠️ Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/ntaffzii/sniff-lens.git
   cd sniff-lens
   ```

2. **Load the extension in Chrome / Brave**:
   - Open your browser and navigate to `chrome://extensions`.
   - Enable **Developer mode** toggle in the top-right corner.
   - Click **Load unpacked** and select the cloned project folder.

3. **Make code changes**:
   - `background.js`: Service worker handling network interception, native debugger keyboard simulation, and download queues.
   - `content.js`: Injected script for DOM/pointer tracking and floating badges.
   - `panel.html` / `panel.js`: Side Panel UI, Lightbox viewer, multi-tab settings manager, and batch handlers.
   - `popup.html` / `popup.js`: Extension action popup.

4. **Reload extension after changes**:
   - Go to `chrome://extensions` and click the **Reload (🔄)** icon on the extension card.

---

## 📋 Guidelines for Pull Requests (PRs)

1. **Create a branch**:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

2. **Commit guidelines**:
   - Write clear, concise commit messages following standard conventions:
     - `feat: add support for new filename template variable`
     - `fix: resolve lightbox keyboard navigation focus issue`
     - `docs: update vision AI webhook examples`

3. **Testing your changes**:
   - Verify that network sniffing captures media without duplication.
   - Test tab switching to verify Multi-Tab Settings Isolation.
   - Test Native Auto-Slide on Facebook / carousels.
   - Ensure no console errors occur in either background service worker or side panel.

4. **Submit your Pull Request**:
   - Push your branch to GitHub and open a PR with a description of the changes made and testing steps.

---

## 🐛 Reporting Issues

If you find a bug or have a feature request:
1. Check the [Issues](https://github.com/ntaffzii/sniff-lens/issues) tab to see if it has already been reported.
2. If not, open a new issue describing:
   - Steps to reproduce
   - Expected behavior vs actual behavior
   - Browser version and OS
   - Screenshots/screen recordings if applicable

---

## 📄 License
By contributing, you agree that your contributions will be licensed under the project's [MIT License](LICENSE).
