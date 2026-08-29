"""
Step 4.4 — LLM-as-a-judge layer.

EVALUATION ONLY. Nothing in this package may be imported by the inference
pipeline (backend/app/pipeline.py) or by a request handler: judge calls take
5-30 s and are capped at 10/min, so they belong in batch jobs.
"""
