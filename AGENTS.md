<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- ds:contract:start -->
# Context.dev design system
- Read `.ds/guide.md` before designing or editing UI; it works with any agent and explains setup, surfaces, components, and verification.
- For new pages or requested features: find components with `npx context-ds list <query> --json`, read `npx context-ds inspect <name> --json`, then install with `npx context-ds add <name>` and connect real application state.
- For restyling an existing interface: run `npx context-ds --dry-run --json` first, then `npx context-ds` and follow its tasks. Preserve copy, links, elements, order, and purpose unless the user explicitly requests changes.
- Choose site or product before styling. Product pages use a 15px root and `.ds-product`; site pages use 16px on phones and 90% from 43.2rem up. Read the component's usage and API rather than guessing props.
- Keep existing content and structure outside the requested change. Do not add decorative sections or replace application behavior as a side effect of styling.
- Use the installed components, their `cn` helper, and brand tokens (`var(--ds-*)`); `npx context-ds tokens <term>` finds a value and `npx context-ds look <file>` shows element rules.
- Validate controlled inputs, every visible action, keyboard focus, overlays, scrolling, and loading/error/empty states. Example data and callbacks are not backend implementations.
- Run `npx context-ds check --changed --json`, the app's own checks, and browser tests at desktop and phone sizes. A clean token check alone does not prove the interface works.
- Review the rendered page against its stated reference with `npx context-ds review <url> --any --json`; follow the review packet if no separate reviewer is available and disclose self-scoring.
- A `ds-override: <reason>` comment only counts after the user approves it with `npx context-ds approve`.
<!-- ds:contract:end -->
