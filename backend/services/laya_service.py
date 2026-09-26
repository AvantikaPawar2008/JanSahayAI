"""
Wraps the Laya typed-decision model for classification (department, urgency)
and ambiguous-case duplicate confirmation. Laya is non-generative: it only
returns a probability, a chosen label from a fixed set, or a score — never
free text. Loaded once at startup, not per-request, to avoid reload latency.
"""

import logging
from typing import Optional, Any, Dict, List
from laya import load as laya_load
from backend.config import get_settings

logger = logging.getLogger("civicpulse.laya")

_model = None

DEPARTMENTS = [
    "Water Supply & Sewerage",
    "Roads & Infrastructure",
    "Solid Waste Management",
    "Electrical & Streetlighting",
    "Health & Sanitation",
]

URGENCY_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]

# Config constants — keep tunable, same pattern as DEDUP_SIMILARITY_THRESHOLD
LAYA_DUPLICATE_CONFIRM_THRESHOLD = 0.60
LAYA_LOW_CONFIDENCE_REVIEW_THRESHOLD = 0.55  # below this, flag needs_admin_review instead of trusting top choice


class LayaDecisionResult:
    """Standardized decision result matching Laya's intended decision interface."""

    def __init__(
        self,
        top_choice: Optional[str] = None,
        top_probability: float = 0.0,
        distribution: Optional[Dict[str, float]] = None,
        probability_true: float = 0.0,
    ):
        self.top_choice = top_choice
        self.top_probability = top_probability
        self.distribution = distribution or {}
        self.probability_true = probability_true


class LayaModelWrapper:
    """
    Adapter around convaiinnovations/laya Agent providing both the high-level
    model.ask(...) interface and forwarding direct model calls to the underlying agent.
    """

    def __init__(self, agent: Any):
        self.agent = agent

    def ask(
        self,
        text: str,
        question_type: str,
        prompt: str,
        options: Optional[List[str]] = None,
    ) -> LayaDecisionResult:
        """
        Executes a typed decision question (choice, score, or noul) in a single forward pass.
        """
        if question_type == "choice":
            criteria = options or DEPARTMENTS
            result = self.agent.predict(
                text,
                {
                    "q": {
                        "type": "choice",
                        "instructions": prompt,
                        "criteria": criteria,
                    }
                },
            )
            ans = result.get("answers", {}).get("q", {})
            choice = ans.get("choice", criteria[0])
            probs = ans.get("probabilities", {})
            top_prob = float(probs.get(choice, ans.get("confidence", 0.0)))
            return LayaDecisionResult(
                top_choice=choice,
                top_probability=top_prob,
                distribution=probs,
            )

        elif question_type == "score":
            criteria = options or URGENCY_LEVELS
            result = self.agent.predict(
                text,
                {
                    "q": {
                        "type": "score",
                        "instructions": prompt,
                        "criteria": criteria,
                    }
                },
            )
            ans = result.get("answers", {}).get("q", {})
            probs = ans.get("probabilities", {})  # e.g. {"0": 0.02, "1": 0.19, "2": 0.37, "3": 0.41}
            # Pick the score option with the highest probability
            if probs:
                best_idx_str = max(probs.keys(), key=lambda k: probs[k])
                best_idx = int(best_idx_str)
                choice = criteria[best_idx] if best_idx < len(criteria) else criteria[0]
                top_prob = float(probs[best_idx_str])
            else:
                choice = criteria[0]
                top_prob = 0.0

            dist = {criteria[int(k)]: float(v) for k, v in probs.items() if int(k) < len(criteria)}
            return LayaDecisionResult(
                top_choice=choice,
                top_probability=top_prob,
                distribution=dist,
            )

        elif question_type == "noul":
            result = self.agent.predict(
                text,
                {
                    "q": {
                        "type": "noul",
                        "instructions": prompt,
                    }
                },
            )
            ans = result.get("answers", {}).get("q", {})
            prob_true = float(ans.get("noul", 0.0))
            return LayaDecisionResult(
                probability_true=prob_true,
                top_probability=prob_true,
            )

        else:
            raise ValueError(f"Unsupported question_type: {question_type}")

    def __getattr__(self, name: str) -> Any:
        return getattr(self.agent, name)


def get_model() -> LayaModelWrapper:
    """
    Returns the cached Laya agent loaded from convaiinnovations/laya multilingual checkpoint.
    Cached at module level to guarantee single startup load and ~33ms inference time.
    """
    global _model
    if _model is None:
        logger.info("📦 Loading Laya typed-decision model (convaiinnovations/laya [multilingual])...")
        agent = laya_load("convaiinnovations/laya", subfolder="multilingual")
        _model = LayaModelWrapper(agent)
        logger.info("✅ Laya model loaded into memory and ready for zero-latency decisions.")
    return _model


def classify_department(report_text: str) -> dict:
    """
    choice question — returns the department with highest probability,
    plus the full distribution for confidence display / needs_admin_review logic.
    """
    model = get_model()
    result = model.ask(
        text=report_text,
        question_type="choice",
        options=DEPARTMENTS,
        prompt="Which municipal department should handle this complaint?",
    )
    return {
        "department": result.top_choice,
        "confidence": result.top_probability,
        "distribution": result.distribution,  # keep for needs_admin_review threshold check
    }


def score_urgency(report_text: str) -> dict:
    """
    score question — returns the urgency level on the ordinal scale.
    """
    model = get_model()
    result = model.ask(
        text=report_text,
        question_type="score",
        options=URGENCY_LEVELS,
        prompt="How urgent is this civic issue, considering safety risk?",
    )
    return {
        "urgency": result.top_choice,
        "confidence": result.top_probability,
    }


def classify_and_score_batch(report_text: str) -> dict:
    """
    Executes department choice and urgency scoring in a single batch forward pass.
    Saves ~50% inference time by evaluating both typed questions together.
    """
    model = get_model()
    try:
        res = model.agent.predict(
            report_text,
            {
                "dept": {
                    "type": "choice",
                    "instructions": "Which municipal department should handle this complaint?",
                    "criteria": DEPARTMENTS,
                },
                "urgency": {
                    "type": "score",
                    "instructions": "How urgent is this civic issue, considering safety risk?",
                    "criteria": URGENCY_LEVELS,
                },
            },
        )
        answers = res.get("answers", {})
        dept_ans = answers.get("dept", {})
        dept_choice = dept_ans.get("choice", DEPARTMENTS[0])
        dept_probs = dept_ans.get("probabilities", {})
        dept_top_prob = float(dept_probs.get(dept_choice, dept_ans.get("confidence", 0.0)))

        urg_ans = answers.get("urgency", {})
        urg_probs = urg_ans.get("probabilities", {})
        if urg_probs:
            best_idx_str = max(urg_probs.keys(), key=lambda k: urg_probs[k])
            best_idx = int(best_idx_str)
            urg_choice = URGENCY_LEVELS[best_idx] if best_idx < len(URGENCY_LEVELS) else URGENCY_LEVELS[0]
            urg_top_prob = float(urg_probs[best_idx_str])
        else:
            urg_choice = URGENCY_LEVELS[1]  # "MEDIUM"
            urg_top_prob = 0.0

        return {
            "department": dept_choice,
            "department_confidence": dept_top_prob,
            "department_distribution": dept_probs,
            "urgency": urg_choice,
            "urgency_confidence": urg_top_prob,
        }
    except Exception as e:
        logger.warning(f"Batch Laya predict failed ({e}), falling back to individual calls.")
        dept_res = classify_department(report_text)
        urg_res = score_urgency(report_text)
        return {
            "department": dept_res["department"],
            "department_confidence": dept_res["confidence"],
            "department_distribution": dept_res.get("distribution", {}),
            "urgency": urg_res["urgency"],
            "urgency_confidence": urg_res["confidence"],
        }


def confirm_duplicate(new_report_text: str, candidate_ticket_text: str) -> dict:
    """
    Direct judgment for ambiguous-zone dedup candidates using Laya typed decisions.
    Since GPS proximity (within 50m) is already verified by spatial filtering,
    evaluates whether Report A and Report B describe the same physical problem.
    """
    clean_a = (new_report_text or "").strip()
    clean_b = (candidate_ticket_text or "").strip()

    if not clean_a or not clean_b:
        return {
            "is_duplicate": False,
            "confidence": 0.0,
        }

    model = get_model()

    try:
        noul_res = model.ask(
            text=f"Report A: {clean_a}\nReport B: {clean_b}",
            question_type="noul",
            prompt="Do Report A and Report B describe the same physical problem?",
        )
        prob = noul_res.probability_true
        is_dup = prob >= LAYA_DUPLICATE_CONFIRM_THRESHOLD
        return {
            "is_duplicate": is_dup,
            "confidence": prob,
        }
    except Exception as e:
        logger.error(f"Laya duplicate check error: {e}")
        return {
            "is_duplicate": False,
            "confidence": 0.0,
        }
