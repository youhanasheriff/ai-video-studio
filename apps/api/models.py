from pydantic import BaseModel
from typing import Optional, Any, List


class GenerateRequest(BaseModel):
    script: str
    keywords: List[str] = []  # Keywords for stock footage search
    language: str = "en"
    voice: str = "nova"  # OpenAI TTS voice: alloy, echo, fable, onyx, nova, shimmer
    voice_speed: float = 1.0
    aspect_ratio: str = "9:16"
    subtitles_enabled: bool = True
    subtitle_style: str = "default"
    subtitle_font: str = "Arial"
    subtitle_font_size: int = 48
    subtitle_primary_color: str = "#FFFFFF"
    subtitle_highlight_color: str = "#FFFF00"
    subtitle_outline_color: str = "#000000"
    subtitle_outline_width: int = 3
    subtitle_shadow_depth: int = 2
    subtitle_position: str = "bottom"
    subtitle_words_per_line: int = 4


class TaskStatusResponse(BaseModel):
    task_id: str
    status: str
    output_url: Optional[str] = None
    progress: Optional[int] = None
    error: Optional[str] = None
    current_step: Optional[str] = None
