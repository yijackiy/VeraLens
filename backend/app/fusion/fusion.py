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
    return {
        "final_verdict": "fake" if final_score > 0.5 else "real",
        "final_confidence": final_score,
        "signals": llm_result["signals"],
        "explanation": llm_result["explanation"],
    }
