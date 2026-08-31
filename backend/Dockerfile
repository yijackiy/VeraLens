# CUDA runtime base, NOT python:slim. The reasoning layer loads Qwen3-VL through
# bitsandbytes in 4-bit, which requires CUDA — on a CPU-only image it does not
# run slowly, it does not run at all.
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-pip python3-dev \
        libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Torch first, from the CUDA 12.4 index. Installing it via requirements.txt
# resolves to CPU wheels and the container silently loses the GPU.
RUN pip3 install --upgrade pip && \
    pip3 install torch torchvision --index-url https://download.pytorch.org/whl/cu124

COPY requirements.txt .
RUN pip3 install -r requirements.txt

COPY backend/ ./backend/
COPY scripts/ ./scripts/

EXPOSE 8000

# Module path is backend.app.api.main, not app.api.main — the code imports
# `from backend.app...` and WORKDIR is the repo root.
CMD ["uvicorn", "backend.app.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
