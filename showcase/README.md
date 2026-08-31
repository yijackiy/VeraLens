# VeraLens — static showcase site

A recorded run of the full pipeline, published as a static page. No backend, no
database, no GPU at serve time, nothing that expires. This is the link to send.

## 1. Generate the data (on the machine with the GPU)

From the `veralens/` root, with the venv active:

```bash
python scripts/export_showcase.py --from-dataset 8
```

That analyses 8 fake + 8 real images and writes `showcase/data/results.json`
plus the crops and heatmaps under `showcase/data/img/`.

To choose the images yourself (recommended — see Publishing below):

```bash
python scripts/export_showcase.py path/to/a.png path/to/b.jpg
```

Both forms can be combined, and `--seed` makes the dataset sample reproducible.

The script runs all the classifier and Grad-CAM work first, unloads it, then
loads Qwen3-VL once for every explanation. That respects the 4GB sequential
loading rule and avoids reloading a 2B model per image.

## 2. Preview locally

```bash
python -m http.server -d showcase 8080
```

Then open <http://localhost:8080>. It must be served over HTTP — opening
`index.html` from the filesystem blocks the `fetch` of `results.json`.

## 3. Deploy

The `showcase/` folder is the entire site. Any static host works:

- **Cloudflare Pages** — create a project, "Direct Upload", drag the folder in.
- **GitHub Pages** — push `showcase/` to a `gh-pages` branch, or point Pages at
  `/showcase` on `main`.
- **Netlify** — drag the folder onto the deploy area.

No build step, no environment variables, no framework.

## Publishing — read before deploying

The `real` class is photographs of real people, and ethics approval for this
project is not yet resolved. Putting labelled face photographs on a public,
indexed URL is a larger step than sending them to an API. Two safe options:

1. Send an unlisted link rather than announcing it publicly, and
2. prefer synthetic/`fake` examples plus a photo of yourself for the `real`
   case, rather than sampling real people's faces from the dataset.

The dataset is CC BY-NC 4.0 — attribution is required and commercial use is
not permitted. The page footer already carries the attribution; leave it there.

## Also worth knowing

`results.json` records the classifier score, the reasoning layer's verdict and
the fused result as three separate fields, so the same file feeds the Step 4.2
ablation table. It is a showcase artefact and a data file at once.
