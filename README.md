# 🎨 Image Studio

A SillyTavern extension for generating images **on demand, from its own panel**. Nothing is ever posted to the chat. It reuses the connections you already set up in **sillyimages** or **SLAY Images**, or runs on its own connection.

Works on desktop and mobile (bottom sheet on phones, movable window on desktop).

## Features

- **Separate generator, connection and model.** Chat can keep using NovelAI while the Studio uses Nano Banana.
- **Prompt with swappable `{tags}`.** Write `1girl, {style}, {quality}` and change each part from a field.
- **Character references (up to 4).** Name them, then write `personA kissing personB`.
- **Image, text, or both per reference.** Each character has its own text prompt and negative prompt.
- **Reference library.** Saved characters you can reuse in any generation.
- **Image library.** Save a result together with the prompt, variables, model and references that made it.
- **SLAY style button** that opens SLAY Images' own style gallery.
- **Movable floating button, opacity slider, collapsible panel.**

## Install

1. Copy the `image-studio` folder (the one containing `manifest.json`, `index.js`, `style.css`) into
   `SillyTavern/data/<your-user>/extensions/`.
2. Restart or reload SillyTavern.
3. Open the panel with the floating 🎨 button, the wand (✨) menu → **Image Studio**, or **Extensions → Image Studio → Open Image Studio**. The wand and Extensions entries are added as soon as SillyTavern builds those menus, even if that is late on a slow phone.

## The three choices on the Create tab

| Choice | What it is |
| --- | --- |
| **Generator extension** | `sillyimages`, `SLAY Images`, or `Standalone` (Image Studio's own connection). |
| **Connection profile** | A saved connection in that extension: API type, endpoint and key. For SLAY there is also "Current SLAY settings". |
| **Model** | Picked from a list in the Studio, independent of the profile's own model. "Profile's model" uses the profile's. "Other…" lets you type an id. ↻ fetches the list from the connection. |

A model can't change the connection. NovelAI direct and Gemini are different endpoints with different keys, so for "NovelAI in chat, Nano Banana in the Studio" you need a profile that points at a Nano Banana connection (a Gemini key, a proxy, or Naistera, which serves both). Your model choice is remembered per profile.

### sillyimages

Profiles come from sillyimages' connection profiles. Image Studio borrows the chosen profile and your chosen model only while it generates, then puts sillyimages' settings back. Nothing is saved to sillyimages. Avoid starting a Studio generation at the exact moment a chat message is generating through sillyimages.

The Setup tab has **Import the extension's styles as {style} options**, which copies your sillyimages styles into the `{style}` variable.

### SLAY Images

SLAY exposes no API to other extensions, so Image Studio builds the requests itself from SLAY's settings. Supported: OpenAI-compatible, Gemini, Naistera and custom URL connections.

- **🎨 Choose style** opens SLAY's own style gallery. The chosen style is added to your prompt as a `[STYLE: …]` block, the same format SLAY uses. It also shows in the final prompt preview. **✕** clears it.
- By default the Studio keeps its own style and puts SLAY's chat style back afterwards. Tick **Share with chat** to use SLAY's current style instead.
- If you see "SLAY style button not loaded", open the SLAY Images settings drawer once and try again.
- Naistera sends reference images only for the Grok and Nano Banana models.

### Standalone

Set it up on the Setup tab.

- **Gemini / Nano Banana proxy:** endpoint and API key (Google's own endpoint or any compatible proxy). Aspect ratio, and size for Pro models.
- **NovelAI:** uses the NovelAI key already saved in SillyTavern (API Connections → NovelAI). Sampler, scheduler, steps, guidance, size, seed, decrisper and variety boost are on the Setup tab.

## Prompts and variables

Write any `{name}` in the main or negative prompt and a variable is created automatically.

- Type a value, or pick a saved option from the dropdown.
- **★** saves the current value as a **named option** (name + content). Open **Edit saved options** under the variable to rename an option, change its content, use it or delete it. The dropdown shows the names; picking one writes its content into the prompt.
- **Rename a variable** by tapping its name (the part in `{ }`). Every `{old}` in your prompt and negative prompt is renamed too.
- 🗑 removes a variable.
- Variables not used in the prompt are greyed out.
- `{{char}}` and `{{user}}` still work.
- **Final prompt preview** shows exactly what will be sent.

## Character references

Up to **4 characters** per image. Add them on the Create tab with **＋ Add character reference**, choosing from the Refs tab library or uploading a new image.

- **Name** each character (for example `personA`) and write the names in your prompt: `personA kissing personB`. Chips under the slots insert a name into the prompt. If an image character isn't mentioned in the prompt you get a warning.
- **Send as:**
  - **Image + text:** the picture is sent, and the text prompt is written in.
  - **Image only:** only the picture is sent.
  - **Text only:** no picture; only the text is used.
- **Text prompt:** how it's delivered depends on the model, so the model actually reads it:
  - **Gemini, OpenAI-style, Naistera, SLAY:** the description is written in after the name (`personA (red hair, green eyes) kissing personB (blue hair)`) **and** listed in a "Characters (draw each exactly as described)" block at the end.
  - **NovelAI V4 / V4.5 through sillyimages:** uses NovelAI's real character prompts. Your prompt is sent as `base | character 1 | character 2`, and each character's negative is sent in the matching position. Write the base as scene tags (`2girls, kissing`) and the character text as tags (`girl, red hair, green eyes`).
  - **NovelAI through Standalone:** SillyTavern's own endpoint has no character prompts, so descriptions are appended to the prompt as tags.
- **Negative prompt:** each character's negative follows the same rules (aligned per character for NovelAI V4, merged into the negative prompt otherwise). Not used for image-only characters.
- **Image + text:** the picture usually wins if it disagrees with the text. Use **Text only** when the text must decide the look.
- **See what was sent:** "Final prompt preview" shows it before you generate, and **Prompt that was sent** under each result shows it afterwards.
- **Text-only characters** (no picture) can be created on the Refs tab with **＋ New text-only character**.
- **Use as reference** on a result or a library image adds it as a reference, to keep a character consistent.
- The **Send** checkbox turns all references off without clearing the slots.

Notes:
- **NovelAI** can't take reference images, but it does use the text part.
- Models that accept fewer than 4 reference images use the first ones and tell you.
- Pictures are shrunk to 1024px and sent as PNG.

## Libraries

Both are stored in your **browser's storage** (IndexedDB), so they are per device and per browser, and are not synced.

- **Library tab:** saved results with search. Tap one to open it:
  - **Name**, **Prompt (with {tags})** and **Negative** are editable. **Save changes** keeps your edits.
  - **Use this prompt** restores the template, negative prompt, variable values, generator, profile, model and references (variables you already have keep their saved options).
  - **Full size**, **Download**, **Use as reference**, **Export** (this one item) and **Delete**.
  - An optional **auto-save** is on the Setup tab.
- **Export / import:** the buttons at the top of the Library tab.
  - **Export prompts** writes a small `.json` file with prompts, variables, models and character info, without pictures.
  - **Export + images** also includes the pictures (the file can get large).
  - **Import from file** adds the entries from a file made by Image Studio. Entries you already have are skipped. Prompt-only entries show a "T" placeholder and work like any other: open one and tap **Use this prompt**. Characters used by imported entries are added to the Refs tab too.
- **Refs tab:** saved characters with name, text prompt, negative prompt and send mode.

## Interface

- **Floating button:** drag it anywhere; its position is saved. Tap to open.
- **Window:** on desktop, drag it by the header. On phones it is a bottom sheet.
- **View full size:** tap a result (or its **⛶ View full size** button) to open it big. Tap the picture to zoom to 100% and scroll around, tap again to fit, ✕ or tap outside to close. ⬇ downloads it.
- **◐ slider** (header): panel opacity, so you can see the chat behind it.
- **▾** collapses the panel, **✕** closes it.
- **Hide the floating button:** untick **Show floating 🎨 button** on the Setup tab or in the Extensions drawer. Reopen from the wand menu or Extensions drawer.
- **Reset button & window position** is on the Setup tab.

## Troubleshooting

- **Wand or Extensions entry missing:** wait a few seconds after SillyTavern loads (they are added once its menus exist). The floating button always works.
- **A red "⚠ …" line under the tabs** means one part of the panel failed to load; the rest still works. Send that text when reporting a problem.
- **Extension "(not found)":** use **Re-scan extensions and profiles** on the Setup tab. Image Studio finds sillyimages and SLAY Images through SillyTavern's installed-extensions list.
- **NovelAI errors:** check that your NovelAI key is saved under API Connections.
- **"API key contains invalid characters":** hidden characters from copy-paste. Re-enter the key.
- **Gemini returns no image:** the prompt may have been blocked. Try rewording it.
- The Studio's own settings live under `image_studio` in SillyTavern's extension settings.

## Credits

Built to work alongside [sillyimages](https://github.com/0xl0cal/sillyimages) and [SLAYimages](https://github.com/wewwaistyping/SLAYimages).
