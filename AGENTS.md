+# Repository Guidelines

## AI Agent Initialization & Required Reading
**CRITICAL INSTRUCTION FOR ALL AI AGENTS:** 
When starting a new session or opening this workspace, you **MUST** immediately read and load the context from the following four foundational documentation files authored by the repository creator before proceeding with any tasks:
1. E:\code\Project\FlowPilot\开发者AI开发与PR提交流程.md
2. E:\code\Project\FlowPilot\项目开发规范（AI协作）.md
3. E:\code\Project\FlowPilot\项目完整链路说明.md
4. E:\code\Project\FlowPilot\项目文件结构说明.md

These documents contain essential knowledge about the project architecture, PR submission rules, development standards, and complete workflow. Your future actions, plans, and task execution must strictly adhere to the guidelines established in these files.

Furthermore, the repository maintains a dynamic knowledge base in the "E:\code\Project\FlowPilot\docs" directory. Before executing a specific task, you must proactively list the contents of this folder (e.g., using Get-ChildItem E:\code\Project\FlowPilot\docs). Based on the task type and requirements, selectively read the relevant documentation files to acquire necessary context and domain knowledge.

This document serves as a contributor guide for developing and maintaining the FlowPilot codebase. Keep changes minimal, maintainable, and aligned with existing project conventions.

## Project Structure & Module Organization

FlowPilot is a browser extension (Chrome/Edge) organized into modular components:
- **Root Directory (`/`)**: Core extension manifests (`manifest.json`, `rules.json`), background scripts (`background.js`), and email provider utilities (`*-utils.js`).
- **`sidepanel/`**: User interface components, views, and settings panels.
- **`content/` & `core/`**: Content scripts injected into web pages and core automation workflow controllers.
- **`flows/`**: Automated step definitions and logic flows for account operations.
- **`shared/`**: Common helper functions and shared constants across UI and background contexts.
- **`tests/`**: Unit and integration test suite (`*.test.js`).
- **`icons/` & `docs/`**: Application assets and technical documentation.

## Build, Test, and Development Commands

- **Run Tests**: `npm test`  
  Executes the automated test suite using Node.js native test runner (`node --test tests/*.test.js`). Always run this before submitting changes.
- **Helper Scripts**:  
  - Windows: `start-custom-mail-helper.bat`, `start-hotmail-helper.bat`  
  - macOS/Linux: `start-custom-mail-helper.command`, `start-hotmail-helper.command`  
  These scripts launch local auxiliary background services for email handling.
- **Local Development**: No build step is required. Load the repository root directly into your browser as an unpacked extension via `chrome://extensions` or `edge://extensions`.

## Coding Style & Naming Conventions

- **Language**: Vanilla JavaScript (ESModules and CommonJS depending on context). Avoid introducing unneeded external dependencies or build steps.
- **Naming Patterns**: 
  - Files: Use kebab-case (e.g., `mail-provider-utils.js`, `signup-step2-email-switch.test.js`).
  - Variables & Functions: Use camelCase (e.g., `handleEmailVerification`).
- **Philosophy**: Follow the KISS principle. Implement root-cause fixes rather than surface patches, and preserve the existing formatting without unrelated batch modifications.

## Testing Guidelines

- **Framework**: Node.js built-in test runner (`node --test`). No external assertion libraries are needed.
- **Conventions**: Test files must reside inside the `tests/` directory and use the `.test.js` suffix.
- **Verification**: Proactively verify edge cases and core workflows. Include specific verification steps or PowerShell commands in your PR descriptions.

## Commit & Pull Request Guidelines

- **Commit Messages**: Follow Conventional Commits formatting (e.g., `fix: ensure SMS channel selected before submitting`, `feat: add English UI language support`). Keep messages concise and descriptive.
- **Pull Requests**: Provide a clear summary of changes, outline any potential risk points, link relevant issues, and include the exact commands used to verify the changes locally. Avoid committing secrets, tokens, or temporary artifacts.
## Git Remotes

- When committing and pushing changes, ensure you are pushing to the forked repository at `https://github.com/supermanzjjhhhh/FlowPilot` rather than the upstream source.
