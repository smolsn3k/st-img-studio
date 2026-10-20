# 🎨 Image Studio

🇷🇺 [Русская версия](README.ru.md)

A SillyTavern extension for generating images **on demand, from its own panel**. Nothing is ever posted to the chat. It reuses the connections you already set up in **sillyimages** or **SLAY Images**, or runs on its own connection.

Works on desktop and mobile (bottom sheet on phones, movable window on desktop).

## Features

- **Separate generator, connection and model.** Chat can keep using NovelAI while the Studio uses Nano Banana.
- **Prompt with swappable `{tags}`.** Write `1girl, {style}, {quality}` and change each part from a field.
- **Character references (up to 4).** Name them, then write `personA kissing personB`.
- **Image, text, or both per reference.** Each character has its own text prompt and negative prompt.
- **Reference pictures with a purpose.** Take a pose, an art style, a composition, an outfit, a background, or a whole picture to recreate with your own characters. Link each one to your prompt with a `{tag}`.
- **Reference library.** Saved characters and reference pictures you can reuse in any generation.
- **English and Russian interface** (Auto, English or Русский).
- **Image library.** Save a result together with the prompt, variables, model and references that made it.
- **SLAY style button** that opens SLAY Images' own style gallery.
- **Movable floating button, opacity slider, collapsible panel.**

## Install

Install it from SillyTavern, no manual copying needed:

1. In SillyTavern, open the **Extensions** panel (the puzzle-piece icon).
2. Click **Install extension**.
3. Paste this URL and confirm:

   ```
   https://github.com/smolsn3k/st-img-studio
   ```

4. Choose whether to install it **for all users** or **just for you**, then reload the page when asked.

Open the panel with the floating 🎨 button, the wand (✨) menu → **Image Studio**, or **Extensions → Image Studio → Open Image Studio**. The wand and Extensions entries are added as soon as SillyTavern builds those menus, even if that is late on a slow phone.

**Updating:** open **Extensions → Manage extensions** and use the update button next to Image Studio (or the update-all button), then reload.

## The three choices on the Create tab

| Choice | What it is |
| --- | --- |
| **Generator extension** | `sillyimages`, `SLAY Images`, or `Standalone` (Image Studio's own connection). |
| **Connection profile** | A saved connection in that extension: API type, endpoint and key. For SLAY there is also "Current SLAY settings". |
| **Model** | Picked from a list that belongs to the chosen generator (see below), independent of the extension's own model. "Profile's model" uses the profile's. "Other…" lets you type an id. ↻ reloads the list. |

A model can't change the connection. NovelAI direct and Gemini are different endpoints with different keys, so for "NovelAI in chat, Nano Banana in the Studio" you need a profile that points at a Nano Banana connection (a Gemini key, a proxy, or Naistera, which serves both). Your model choice is remembered per profile.

### sillyimages

Profiles come from sillyimages' connection profiles. The model list is what sillyimages' own provider returns for the chosen profile (the same list its settings page shows), with its own names, so you only ever see sillyimages models.

**The Studio never changes sillyimages.** For each generation or list lookup it works on a private copy of sillyimages' settings (the chosen profile's connection plus your Studio model). sillyimages' real settings are not written to, and if SillyTavern saves settings while a generation is running, the original values are what get saved. Your chat model and connection stay exactly as you set them. One thing to avoid: starting an image from chat through sillyimages at the very moment a Studio image is generating, since sillyimages would briefly read the Studio's copy.

The Setup tab has **Import the extension's styles as {style} options**, which copies your sillyimages styles into the `{style}` variable.

### SLAY Images

SLAY exposes no API to other extensions, so Image Studio builds the requests itself from SLAY's settings. Supported: OpenAI-compatible, Gemini, Naistera and custom URL connections.

The model list for a SLAY connection is built the same way SLAY builds its own: from the connection's model list (Naistera uses SLAY's fixed list). Image Studio never writes to SLAY's connection or model.

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
- **Use as character** on a result or a library image adds it as a character, to keep a character consistent.
- The **Send** checkbox turns all references off without clearing the slots.

Notes:
- **NovelAI** can't take reference images, but it does use the text part.
- Models that accept fewer than 4 reference images use the first ones and tell you.
- Pictures are shrunk to 1024px and sent as PNG.

## Reference pictures

Up to **3 reference pictures** per image, set on the Create tab under **Reference pictures** (**＋ Add reference picture**, then pick a saved one or upload one). Saved ones live on the **Refs** tab under **References**.

Every reference picture has a **purpose**, so the model knows what to take from it and what to ignore:

| Purpose | What is taken |
| --- | --- |
| **Pose** | The body pose, limb placement and camera angle. Not the person, clothes or background. |
| **Art style** | The art style, colors, lighting and rendering. Not its subjects. |
| **Composition** | The layout, framing, camera angle and perspective. |
| **Outfit** | The clothing and accessories. Not the person or pose. |
| **Background** | The setting. Not any people. |
| **Whole picture (recreate it)** | Everything: composition, pose, style and mood, but with **your characters** instead of its subjects. Use it for "make a picture like this one, with my character". |

**Linking it to your prompt with a `{tag}`.** Each reference picture has a tag name (shown as `{pose}`, `{artstyle}`, `{like}`…; you can rename it). Tap its chip above the prompt, or type it, for example:

```
personA sitting at a cafe, in {pose}, drawn in {artstyle}
```

Image Studio turns each tag into a clear instruction pointing at that picture ("the pose from reference image “pose”"), and tells the model which image is which. If you don't write the tag, the instruction is added at the end of the prompt for you, so a reference is never ignored. Tags can use any letters, including Russian.

- **Text:** each reference can also have words (`sitting cross-legged, looking over her shoulder`) and a **negative** (`crossed arms`). With a tag, the words are written in next to the instruction.
- **Send as:** **Image + text**, **Image only** or **Text only**, same as characters. Text-only references need no picture (**＋ New text-only reference** on the Refs tab); the tag is then replaced by your words.
- **Several at once:** for example a pose reference and an art-style reference together, each with its own tag.
- **Image limits:** reference pictures count toward the model's reference-image limit, after your characters. If the limit is reached, the extra picture is skipped (you get a notice) and its text is still used.
- **NovelAI** can't take reference images, so only the text is used (the tag is replaced by the words, and the negative joins the negative prompt).
- **Use as reference picture** on a result or a library image turns it into a reference. **Use as character** turns it into a character.
- The **Send** checkbox next to Reference pictures turns them all off without removing them. Saved library entries remember their reference pictures, and export/import carries them along.
- Pose references from earlier versions are converted automatically (purpose: Pose).

## Language

**Setup → Language:** **Auto** follows SillyTavern's language, or choose **English** / **Русский**. Only the Image Studio interface and its messages change. Your prompts, names and saved items are never translated, and the text sent to the image models stays in English.

## Libraries

Both are stored in your **browser's storage** (IndexedDB), so they are per device and per browser, and are not synced.

- **Library tab:** saved results with search. Tap one to open it:
  - **Name**, **Prompt (with {tags})** and **Negative** are editable. **Save changes** keeps your edits.
  - **Use this prompt** restores the template, negative prompt, variable values, generator, profile, model and references (variables you already have keep their saved options).
  - **Full size**, **Download**, **Use as character**, **Use as reference picture**, **Export** (this one item) and **Delete**.
  - An optional **auto-save** is on the Setup tab.
- **Export / import:** the buttons at the top of the Library tab.
  - **Export prompts** writes a small `.json` file with prompts, variables, models and character info, without pictures.
  - **Export + images** also includes the pictures (the file can get large).
  - **Import from file** adds the entries from a file made by Image Studio. Entries you already have are skipped. Prompt-only entries show a "T" placeholder and work like any other: open one and tap **Use this prompt**. Characters used by imported entries are added to the Refs tab too.
- **Refs tab:** saved characters and reference pictures (switch with **Characters / References**). Characters have a name, text prompt, negative prompt and send mode; reference pictures also have a purpose and a tag name.

## Interface

- **Floating button:** drag it anywhere; its position is saved. Tap to open.
- **Window:** on desktop, drag it by the header. On phones it is a bottom sheet.
- **View full size:** tap a result (or its **⛶ View full size** button) to open it big. Tap the picture to zoom to 100% and scroll around, tap again to fit, ✕ or tap outside to close. ⬇ downloads it.
- **◐ slider** (header): panel opacity, so you can see the chat behind it.
- **▾** collapses the panel, **✕** closes it.
- **Hide the floating button:** untick **Show floating 🎨 button** on the Setup tab or in the Extensions drawer. Reopen from the wand menu or Extensions drawer.
- **Reset button & window position** is on the Setup tab.

## Troubleshooting

- **It won't open (phone or desktop):** open **Extensions → Image Studio**. The title shows the installed version (so you can tell the update applied). **Open Image Studio** opens the popup; a small "opening…" message appears when your tap is received, and a status line under the button says whether it worked.
- **Image Studio is a separate popup.** It is drawn in the browser's top layer, so it appears above SillyTavern's menus and drawers instead of behind them, and if something else is shown over it, it raises itself back on top. SillyTavern's own notifications can't show above it, so while it is open they appear inside the popup.
- **Red ⚠ button (bottom-left):** if Image Studio fails to load or hits an error it can't recover from, this appears. Tap it to see the reason, then **Copy** and send that text to whoever maintains the extension. The same report is under **Setup → Run self-check**.
- **Other ways to open it:** the floating 🎨 button, the wand (✨) menu, the slash command `/imagestudio`, or add `?imagestudio` to the end of SillyTavern's address (for example `http://localhost:8000/?imagestudio`), which also brings back a hidden floating button.
- **Popup opens but you can't see it:** Image Studio checks this itself and raises it above whatever is covering it. Only if that is impossible on your device does it fall back to showing inside the Extensions menu, and the status line says so. (Needs a browser with the Popover API: Chrome/Edge 114+, Safari 17+, Firefox 125+. Older browsers use a normal floating window.)
- **Wand or Extensions entry missing:** they are added once SillyTavern builds those menus, which can take a few seconds on a phone. The floating button always works.
- **A red "⚠ …" line under the tabs** means one part of the panel failed to load; the rest still works. Send that text when reporting a problem.
- **Extension "(not found)":** use **Re-scan extensions and profiles** on the Setup tab. Image Studio finds sillyimages and SLAY Images through SillyTavern's installed-extensions list.
- **NovelAI errors:** check that your NovelAI key is saved under API Connections.
- **"API key contains invalid characters":** hidden characters from copy-paste. Re-enter the key.
- **Gemini returns no image:** the prompt may have been blocked. Try rewording it.
- The Studio's own settings live under `image_studio` in SillyTavern's extension settings.

## Credits

Made by [smolsn3k](https://github.com/smolsn3k). Built to work alongside [sillyimages](https://github.com/0xl0cal/sillyimages) and [SLAYimages](https://github.com/wewwaistyping/SLAYimages).
