# UI refresh prototype

The current four-role mockup is described in [the v3 design specification](ui-refresh-v3-design.md).

- Preview: `/login/ui-preview#coach` on the `ui-refresh` Vercel branch deployment.
- Roles: Coach, GM, Owner, Around the League.
- Palette: electric blue, hot orange, ice white, midnight ink.
- All data, edits, offers, claims, votes and staff responses are local samples. Reload to reset.
- Select a radial to change the workspace; expand it on desktop or open it at full width on mobile.
- Deep links use `#role/feature` and optionally `/expanded`. Keyboard arrows switch role tabs; touch swipes work on non-control scene areas.
- Team strategy and owner-set player values remain private. The preview contains no opponent valuation records.
- Existing live routes and authentication are preserved. This UI prototype makes no live league, AI, messaging or transaction requests.
- `/classic` remains the previous home. No production merge is part of this branch.

Run `npm run dev` for local development and `npm run build` for validation. Targeted source is under `src/home/prototype`.

New scene images use the built-in image-generation tool. See [exact artwork prompts](ui-refresh-v3-art-prompts.txt). Prior iteration prompts are retained in the other UI-refresh art documents.
