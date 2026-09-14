# UI refresh prototype

This branch replaces the signed-in home page with Coach, GM, and Owner scenes, in that order, and a left-aligned Studio Mono radial menu. The previous home is still available at /classic.

## Try it
- Run npm ci, then npm run dev.
- Open /login/ui-preview for a self-contained design preview. Identity, matchup projections, roster assets, draft picks, standings, and the proposal are clearly labeled illustrative samples. This route makes no private data requests.
- The preview sits beneath the existing public /login route; middleware and API authorization are unchanged.
- Sign in normally and open / for your stored team identity and direct links to existing tools.
- Deep-link to #coach, #gm, or #owner. Legacy #field links still select Coach.
- Select a top tab, use Left/Right/Home/End while a tab is focused, click scene arrows, or swipe horizontally on non-control areas on touch devices.
- The rail pulse runs once per scene entry. Backgrounds crossfade and gently dim; prefers-reduced-motion suppresses motion.
- Whole action rows are interactive, with visible keyboard focus. Dialogs use the browser's modal focus handling and Escape dismissal.

## Scope
- Coach roster, lineup, matchup, standings, owners meeting, and proposals open coming-soon dialogs. No live scoring or backend writes are part of this prototype.
- Trade builder, trade studio, scouting board, historian, and director offices link to existing routes.
- The preview requires sign-in for existing workspaces. Sign-in returns through the app's existing login flow.
- The app uses Studio Mono: warm graphite (#272421), chalk (#f5f2ec), and vermilion (#e47560). Open circular actions, separators, an entry rail pulse, and understated tab underlines retain Option C's menu format.
- Scene illustrations are illustrative concept artwork and do not imply real players, stadiums, or live data.
- Desktop places the radial menu on the left and one fantasy context panel on the right. Coach shows a sample matchup and four featured starters; GM has roster/draft-capital toggles and a staff briefing; Owner shows example standings and a league proposal.
- Mobile keeps the same full-screen background and menu. The context panel becomes a compact expandable summary above the actions. Narrow/short screens scroll rather than clipping the fourth GM action.
- Signed-in context panels are labeled coming soon until connected to league data; they do not display the preview's sample stats as the user's own.
- Prototype only: no production merge or production deployment is part of this branch.

## Assets
Scene JPEGs are in public/ui-refresh. The active studio-* illustrations use a drawn sports-game style: a coach and team at the sideline, a GM draft-board room, and an owner's boardroom overlooking the stadium. Created with built-in image generation and JPEG-compressed with sharp; no rasterized UI. Real HTML/CSS controls render on top. Current source prompts are recorded in docs/studio-mono-art-prompts.md; the previous iteration is documented in docs/ui-refresh-art-prompts.md.
