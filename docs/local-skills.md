# Local skills

A Hane local skill is a versioned JSON instruction bundle. It is not a Node
module, executable script, tool grant, connector, or credential container.
Installing a skill snapshots its validated manifest into SQLite for discovery;
it cannot read files, make requests, run commands, or receive permissions.

## Manifest

Create a directory with a `skill.json` file:

```json
{
  "schemaVersion": 1,
  "id": "review.release-notes",
  "version": "1.0.0",
  "name": "Release-note reviewer",
  "description": "Produces a concise, evidence-first release-note review.",
  "instructions": "Focus on user-visible changes. State missing evidence explicitly.",
  "tags": ["review", "release"]
}
```

Then install and inspect it:

```powershell
hane skills install A:\my-skills\release-note-reviewer
hane skills list
```

`GET /api/skills` exposes only discovery metadata — never the instruction text
or the local source path. Selecting skills for an individual mission is a
separate, upcoming approval and prompt-composition slice.
