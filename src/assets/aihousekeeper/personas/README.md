# Aihousekeeper Personas

Four character avatars the user can pick from for their AI Housekeeper
(Aihousekeeper). The mapping is defined in [`../personas.ts`](../personas.ts).

## Files expected in this folder

Drop these four PNGs here with the exact filenames below. All should be
transparent-background, square-ish, minimum 512×512 (1024 px
recommended for Retina @3x).

| File | Character | Default mode |
|---|---|---|
| `cat.png` | Teal cat with bow + glasses | `family_chat` |
| `dog.png` | Teal dog with floppy ears | `task_assistant` |
| `alien-male.png` | Teal alien man with dark hair | `report_assistant` |
| `alien-female.png` | Teal alien woman with dark hair | `contractor_context` |

## How to add them

1. Save the four images the user provided (cat / dog / alien-m / alien-f)
   from their chat upload to disk.
2. Move them into this folder (`src/assets/aihousekeeper/personas/`) with the
   filenames in the table above.
3. Metro will hot-reload and the persona picker in
   **Aihousekeeper → Settings → Persona** will start showing the options. The
   default persona if none has been selected is `cat`.

The four `require(...)` lines at the bottom of `../personas.ts` point
at these exact filenames — Metro will fail the bundle with a clear
error if any of the four is missing, so the app won't ship broken.
