# UI refresh prototype

This branch replaces the signed-in home page with three full-screen franchise scenes and a left-aligned radial menu. The previous home is still available at /classic.

## Try it
- Run npm ci, then npm run dev.
- Open /login/ui-preview for a self-contained design preview. This route uses sample identity only and makes no private data requests.
- The preview sits beneath the existing public /login route; middleware and API authorization are unchanged.
- Sign in normally and open / for your stored team identity and direct links to existing tools.
- Deep-link to #field, #owner, or #gm.
- Select a top tab, use Left/Right/Home/End while a tab is focused, click scene arrows, or swipe horizontally on non-control areas on touch devices.
- The rail pulse runs once per scene entry. Backgrounds crossfade and gently dim; prefers-reduced-motion suppresses motion.
- Whole action rows are interactive, with visible keyboard focus. Dialogs use the browser's modal focus handling and Escape dismissal.

## Scope
- Field roster, lineup, matchup, standings, owners meeting, and proposals are clearly labeled coming-soon dialogs; no fabricated live data or backend writes.
- Trade builder, trade studio, scouting board, historian, and director offices link to existing routes.
- The preview requires sign-in for existing workspaces. Sign-in returns through the app's existing login flow.
- The app uses a warm graphite / forest / chalk palette with a terracotta interaction accent.
- Scene illustrations are illustrative concept artwork and do not imply real players, stadiums, or live data.
- Desktop and mobile share the same component. Narrow/short screens can scroll rather than clipping the fourth GM action.
- Prototype only: no production merge or production deployment is part of this branch.

## Assets
Scene JPEGs are in public/ui-refresh. Created with built-in image generation and JPEG-compressed with sharp; no rasterized UI. Real HTML/CSS controls render on top. The exact source prompts are recorded in docs/ui-refresh-art-prompts.md.
