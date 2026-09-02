def fuse(classifier_score: float, llm_result: dict, w_vision: float = 0.55, w_llm: float = 0.45) -> dict:
    """
    Combines the EfficientNet-B4 fake-probability score with the Qwen3-VL
    forensic verdict into a single explained result.
    """
    if llm_result["verdict"] == "unknown":
        # LLM output failed to parse — fall back to the classifier alone
        # rather than letting confidence=0.0 get misread as "certainly real"
        # (1 - 0.0 = 1.0 fake_prob would otherwise skew the fusion).
        final_score = classifier_score
    else:
        llm_fake_prob = llm_result["confidence"] if llm_result["verdict"] == "fake" \
            else 1 - llm_result["confidence"]
        final_score = w_vision * classifier_score + w_llm * llm_fake_prob
    verdict = "fake" if final_score > 0.5 else "real"
    return {
        "final_verdict": verdict,
        # The fused Fake Probability: always oriented toward fake, whatever the
        # verdict. This is the number to feed metrics.
        "fake_probability": final_score,
        # Confidence in the verdict actually stated. Without the flip, a REAL
        # verdict at fake_probability 0.18 renders as "REAL (18.0%)", which
        # reads as barely-confident when it means the opposite.
        "final_confidence": final_score if verdict == "fake" else 1 - final_score,
        # The classifier's own Fake Probability, before fusion. Without it the
        # 0.55/0.45 split is invisible to the caller and the fused number reads
        # as though the classifier produced it — which it did not.
        "classifier_score": classifier_score,
        # False when the VLM's reply could not be parsed after every retry.
        # The explanation and signals below are then placeholders rather than
        # content ("Parsing failed — raw output logged for debugging.", []), so
        # a caller that renders them blindly shows a debug string to a user.
        # The verdict itself is unaffected: the classifier ran either way.
        "explanation_available": llm_result["verdict"] != "unknown",
        "signals": llm_result["signals"],
        "explanation": llm_result["explanation"],
    }
