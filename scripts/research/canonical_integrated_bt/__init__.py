"""Research-only deterministic integration kernel; NOT an anchor-verified BT."""
from .core import ReplayError, replay_synthetic, required_anchor_evidence

__all__ = ["ReplayError", "replay_synthetic", "required_anchor_evidence"]
