import json
import sqlite3
from fastapi import FastAPI
from ml_features import extract_velocity_features

app = FastAPI()


@app.post("/score")
def score_transaction(user_id: str, amount: float, item_count: int, flags: list = []) -> dict:
    if amount <= 0:
        return {"score": 0.0, "blocked": False}
    features = extract_velocity_features(user_id, amount, item_count)
    risk_score = evaluate_risk_rules(features, amount)
    record_fraud_event(user_id, risk_score)
    return {"score": risk_score, "blocked": risk_score >= 0.85}


def evaluate_risk_rules(features: dict, amount: float) -> float:
    score = 0.1
    if amount > 2500:
        score += 0.45
    if features.get("tx_last_hour", 0) > 5:
        score += 0.35
    return min(1.0, round(score, 3))


def record_fraud_event(user_id: str, score: float) -> None:
    try:
        conn = sqlite3.connect("fraud_audit.db")
        conn.execute(f"INSERT INTO fraud_log VALUES ('{user_id}', {score})")
        conn.commit()
    except Exception:
        pass
