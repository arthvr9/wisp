# Workflows

## ci.yml

Runs on every push to `master` and on every pull request, on `ubuntu-latest` with Node 22.
Installs with `npm ci` and then runs each check as its own step, so a red run says which one
failed: `format:check`, `lint`, `typecheck`, `test`, `build`. The last step runs `npm run sprites`
and fails if the working tree is dirty afterwards. The sprite sheets, tray icons and README
images are committed but generated, and this is the only place that can prove they still match
their generators. If that step fails, run `npm run sprites` locally and commit the result.

## release.yml

Triggered by pushing a tag matching `v*`, or by hand through the Actions tab (Run workflow) with
the tag as an input. The tag has to exist already in the manual case.

It packages Linux on `ubuntu-latest` and Windows on `windows-latest` in a matrix, using the
`package:linux` and `package:win` scripts. Both legs upload their output as workflow artifacts
(`wisp-linux`, `wisp-windows`). A second job then takes `wisp-linux` and creates a draft release
for the tag with generated notes.

Only the Linux files are attached to the release. Wisp has never been run on Windows, so the
installer from that leg is a workflow artifact for the owner to download and test, not something
to hand to a stranger from the releases page. The Windows leg failing does not block the release.

Nothing is signed and nothing but the automatic `GITHUB_TOKEN` is needed.

## Cutting a release

1. Make sure `master` is green in CI.
2. Bump `version` in `package.json` (and anything in the README that names the version).
3. Commit that, for example `chore(release): 0.1.0`, and push it to `master`.
4. Tag it and push the tag:

   ```
   git tag v0.1.0
   git push origin v0.1.0
   ```

   The tag must be `v` plus the exact `package.json` version. The workflow checks this and stops
   before building if they disagree.

## What the maintainer still does by hand

- Write the release description. The workflow only drafts the release with generated notes, it
  never publishes it.
- Download the `wisp-windows` artifact from the run if the Windows build matters to you, test it
  on a Windows machine, and attach the files to the release yourself if they work.
- Publish the draft when the description is ready.
- Expect signing warnings and say so in the notes if needed. An unsigned AppImage runs, an
  unsigned deb installs with a warning about an unverified origin, and an unsigned Windows
  installer triggers SmartScreen. Removing the Windows warning needs an EV certificate, which
  this project does not have.

## The GIFs in docs/images

`npm run sprites` also regenerates the animated GIFs, and those need Aseprite, which is a paid
app compiled locally rather than something a runner has. When it is missing the GIF step says
so and leaves the committed files alone, so the sprite sheets are still checked against their
generator on CI. Regenerate the GIFs on a machine that has Aseprite, or point `WISP_ASEPRITE`
at the binary. Pass `--require-aseprite` to make its absence an error instead.
