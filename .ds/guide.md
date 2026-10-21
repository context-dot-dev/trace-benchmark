# Context.dev design system: agent instructions

Use this library to build pages and interfaces for Context.dev. This is the design-system CLI (`context-ds`), not the web-data API CLI. Installing components needs no API key. Any agent that can read files or HTTP responses can use this reference; an agent with a shell can also run the CLI.

## Start by choosing the task

- **Build a new page or add a feature:** inspect existing project conventions, run `init` if the design system is not installed, find and inspect components, then `add` the ones you need. Preserve existing behavior outside the requested change.
- **Restyle an existing interface:** preview the default command with `--dry-run --json`, then run it to convert styles. Preserve copy, links, elements, order, and screen purpose unless the user explicitly requested changes. Run the next task it prints until the work passes validation.
- **Read or plan only:** `guide`, `list`, `inspect`, and `tokens` do not change the project. Do not run the default command just to discover the library: it changes styles on its first run.

## Read before editing

1. Choose a surface. `site` is for marketing pages; `product` is for dashboards and working interfaces. Use `both` items with the appropriate surface and variant.
2. Search: `npx context-ds list "navigation" --surface product --json`. You can also filter with `--type ui`, `site`, `product`, `block`, `visual`, `hook`, or `lib`.
3. Inspect: `npx context-ds inspect sheet --json`. Read `usage`, `avoid`, `api`, `files`, `requires`, `packages`, `examples`, and `reference`. Do not guess exports, prop names, variants, or composition.
4. Install: `npx context-ds add sheet --surface product --dry-run --json`, then the same command without `--dry-run`. Dependencies and the theme are included. Existing files are kept unless you explicitly pass `--overwrite`; inspect a diff before choosing that option.
5. Read the installed source and adapt its data, callbacks, links, labels, and state to the actual application. Examples are demos with local state, not authentication, billing, API, or persistence implementations.

## Set up a project

Run from the application's root (not a monorepo's unrelated package):

```sh
npx -y github:anwarlemu/context-dev-brand-cli#release init --surface product
npx context-ds list "form" --surface product --json
npx context-ds inspect field input button --json
npx context-ds add field input button --surface product --json
```

Use `--surface site` for marketing pages. `init` installs the theme, font wiring, and agent instructions without converting existing component styles. It reports every changed file. `--dry-run --json` previews the changes. Keep existing application structure, routes, and content.

Copied React components require React 19.2 or newer and Tailwind CSS 4. Configure `@/*` to resolve to your source directory in both TypeScript and the bundler. The CLI reports missing requirements. Other frameworks can use the tokens and the restyling workflow, but cannot render the React components directly.

## Apply the right surface

- Wrap product UI in `<Surface kind="product">` from `@/lib/surface`. A product document uses a **15px root font size**; setting only `.ds-product` does not change rem-based spacing. Marketing documents use a **16px root on phones and 90% (14.4px at default browser settings) from 43.2rem up**. The installed site stylesheet sets this breakpoint. Use separate layouts or routes when an application has both.
- Use `<Surface kind="site">` for a marketing region. Include the installed global brand stylesheet and Tailwind theme once. Do not copy the docs site's sandboxed iframe wrapper into the application.
- Keep the provided colors, type, radii, spacing, shadows, and interaction states. Find tokens with `npx context-ds tokens <term> --json`. Reuse the component's variants before adding classes.
- Use the supplied `cn` helper. It understands the design system's custom Tailwind sizes; a generic merge function can discard required classes.
- Client components keep their `"use client"` directive. Provide stable data and real callback implementations. Do not copy demo credentials or hard-coded example account state into a production integration.

## Compose and connect

- **Product page:** `AppShell` contains navigation and the page scroller. Place `PageColumn`, `PageHeader`, and page content inside it. Page blocks demonstrate complete layouts; connect their routes and example state to the host app.
- **Marketing page:** use `SiteHeader`, `Hero`, `SiteSection`, relevant content sections, a CTA, and `SiteFooter` as the task requires. `SiteSection` supplies the column and gutters needed by ring frames and section rules. Do not place framed cards directly against the viewport edge.
- **Forms:** connect `value`/`checked` and change callbacks to state. `Field` associates a label and messages with one control. Compute and clear `error` from validation; the field itself is not a validator. Keep disabled/loading examples only when that state is real.
- **Overlays:** sheets are non-modal detail panels, so the adjacent list remains usable. Dialogs are modal and need a title, a dismissal path, and working submit/cancel handlers. Menus and popovers stay within their viewport. Use the provided portal surface so overlays inherit the correct tokens.
- **Navigation:** blocks emit a cancelable `ds:navigate` event before falling back to a page load. Connect it to your router, or replace example navigation with your route components. Do not ship `/preview/` links from docs examples.
- **Visuals:** reuse library glyphs and dot animations. Respect reduced motion, preserve accessible labels, and retain cleanup for animation frames, timers, listeners, and observers.
- **Examples:** `exampleFiles` contains the main example and any relative helper files it imports. These are reference code, separate from the installed component files. Install `exampleRequires` and `examplePackages` before copying an example; they may exceed the component's own dependencies.

## Verify before reporting completion

```sh
npx context-ds check --changed --json
# Run the application's own type check, tests, and production build.
npx context-ds review http://localhost:3000/your-page --any --json
```

The token check catches style values; it does not prove correct layout, accessibility, interactions, or backend integration. In a real browser test the requested page at 1440px and 390px, including keyboard navigation, focus return, open overlays, scroll edges, validation success/failure, empty/loading states, and every visible action. Compare product UI with the dashboard reference and marketing UI with context.dev. Read the reference coverage record: not every component is publicly visible on the marketing site.

`review` can use an installed reviewer or write a packet for the current agent. Follow the returned instructions and submit the completed scorecard when required. State which pages were tested, which reference was used, and whether the review was self-scored. Never treat an unavailable reviewer or a generated screenshot as a passing score.

## Files and HTTP resources

- Agent guide: https://context-ds.vercel.app/agents.md
- Short discovery index: https://context-ds.vercel.app/llms.txt
- Full component catalog: https://context-ds.vercel.app/llms-full.txt
- Searchable JSON index: https://context-ds.vercel.app/r/index.json
- Per-component Markdown: https://context-ds.vercel.app/components/{name}.md
- Per-component metadata, API, examples, and source: https://context-ds.vercel.app/r/{name}.json
- Tokens: https://context-ds.vercel.app/r/theme.json
- Reference coverage and measurements: https://context-ds.vercel.app/reference-audit.json

Prefer the bundled CLI registry for reproducible offline inspection. Hosted docs may be newer; compare the registry revision before mixing sources. `.ds/guide.md` and `AGENTS.md` keep the instructions with the project. Automatic hooks depend on the host agent and its configuration; every agent can run the explicit checks above.
