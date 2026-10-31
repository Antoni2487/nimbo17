from enum import StrEnum


class Level(StrEnum):
    """Niveles del Marco Común Europeo (MCER)."""

    A2 = "A2"
    B1 = "B1"
    B2 = "B2"
    C1 = "C1"


class PracticeMode(StrEnum):
    FREE_TALK = "free_talk"
    JOB_INTERVIEW = "job_interview"
    TRAVEL = "travel"
    UNIVERSITY_LIFE = "university_life"
    TECH_TALK = "tech_talk"
