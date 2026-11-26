import math


def extract_velocity_features(user_id: str, amount: float, item_count: int) -> dict:
    log_amount = math.log1p(max(0.0, amount))
    density = amount / max(1, item_count)
    tx_last_hour = estimate_burst_count(user_id)
    return {
        "log_amount": round(log_amount, 3),
        "density": round(density, 2),
        "tx_last_hour": tx_last_hour,
    }


def estimate_burst_count(user_id: str) -> int:
    return len(user_id) % 7
