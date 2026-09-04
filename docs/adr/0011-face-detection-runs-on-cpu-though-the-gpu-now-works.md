# Face detection runs on CPU, though the GPU now works

`requirements.txt` installs `onnxruntime-gpu`, `face_pipeline.py` can load the
CUDA execution provider, and the default is still `VERALENS_FACE_DEVICE=cpu`.
That looks like a mistake, so:

Measured on the GTX 1650, buffalo_l at det_size 640×640, best of three after a
warm-up:

| | detection | VRAM held |
| --- | --- | --- |
| CPU | 0.23 s | 0 MiB |
| CUDA | 0.05 s | 805 MiB |

The saving is 0.2 seconds on an analysis that takes 60–210 seconds end to end —
under half a percent. The cost is a fifth of the card, permanently: this module
builds its `FaceAnalysis` at import and never unloads it, so unlike the
classifier and the VLM it is resident for the life of the process. The rest of
the pipeline is built around sequential loading precisely because 4 GB does not
fit two models at once, and Qwen3-VL's 4-bit load — which is where memory
pressure has already produced an intermittent access violation — would be doing
it with 805 MiB less headroom.

So the provider works and is one environment variable away. It is off because
the arithmetic says so, not because it is broken.

## How it was broken, which is the part worth remembering

Two separate faults, and the first hid the second.

`onnxruntime` and `onnxruntime-gpu` were both installed. They write the same
`onnxruntime` package directory, so the CPU build's binaries won and
`get_available_providers()` did not list CUDA at all.

With that cleared, `onnxruntime-gpu` resolved to 1.28.0, which is built against
CUDA 13 and wants `cublasLt64_13.dll`. torch here is the cu124 wheel and ships
CUDA 12. 1.22.0 is the last CUDA 12 build, and torch's own `lib` directory has
every DLL it needs — `cudart64_12`, `cublas64_12`, `cublasLt64_12`,
`cudnn64_9` — so no system CUDA toolkit is required, only that the directory is
findable. `os.add_dll_directory` does not do that: the CUDA provider is a
separate DLL loaded by ONNX Runtime itself, and its transitive dependencies
resolve through the ordinary search path. Prepending torch's `lib` to `PATH`
before `insightface` is imported is what works.

## Consequences

- `onnxruntime-gpu` is pinned to `==1.22.0` and must move only when torch's
  CUDA major version moves. An unpinned install silently reintroduces the bug.
- The module now prints the providers actually in use, not the ones requested.
  This code asked for `CUDAExecutionProvider` and ran on CPU for months; the
  only evidence was a `UserWarning` in the startup log. A request is not an
  outcome and the log should not report it as one.
- Any recorded timing that predates this is a CPU-detection timing. The
  difference is 0.2 s, so nothing in `results/` needs regenerating, but the
  claim on the analyzing screen that an analysis takes 60–90 seconds is wrong
  for a different reason: measured runs on this machine took 63 s to 214 s, and
  almost all of that is Qwen3-VL.
- If the intermittent access violation at the VLM load is ever traced to VRAM,
  this is one of the levers — but it is a lever that was never pulled, since
  detection has been on CPU the whole time. The crash predates any GPU
  detection and is not explained by it.
