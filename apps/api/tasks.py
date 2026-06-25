import asyncio
import os
import shutil
import re
from pathlib import Path
from typing import Dict, Any, List, Optional, cast
from celery_app import celery_app
from video_composer.composer import VideoComposer
from video_composer.config import get_settings
from redis_db import get_redis_db


def extract_keywords_from_script(script: str, max_keywords: int = 5) -> List[str]:
    """Extract meaningful keywords from the script for stock footage search."""
    # Common words to exclude
    stop_words = {
        'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
        'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
        'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
        'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above',
        'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here',
        'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more',
        'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
        'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or',
        'because', 'until', 'while', 'this', 'that', 'these', 'those', 'what',
        'which', 'who', 'whom', 'its', 'it', 'you', 'your', 'we', 'our', 'they',
        'their', 'i', 'me', 'my', 'let', 'lets', 'ever', 'never', 'also', 'get',
        'got', 'goes', 'going', 'come', 'coming', 'make', 'made', 'take', 'took',
    }

    # Clean and tokenize
    words = re.findall(r'\b[a-zA-Z]{3,}\b', script.lower())

    # Filter and count
    word_counts = {}
    for word in words:
        if word not in stop_words:
            word_counts[word] = word_counts.get(word, 0) + 1

    # Sort by frequency and return top keywords
    sorted_words = sorted(word_counts.items(), key=lambda x: x[1], reverse=True)
    keywords = [word for word, count in sorted_words[:max_keywords]]

    # If no keywords found, use generic ones
    if not keywords:
        keywords = ["technology", "business", "innovation"]

    return keywords


def update_task_status(
    task_id: str,
    status: str,
    progress: Optional[int] = None,
    output_url: Optional[str] = None,
    error: Optional[str] = None,
    current_step: Optional[str] = None,
):
    """Update task status in Redis database."""
    try:
        redis_db = get_redis_db()
        generation = redis_db.get_generation(task_id)

        updates: Dict[str, Any] = {"status": status}
        if progress is not None:
            updates["progress"] = progress
        if output_url:
            updates["output_url"] = output_url
        if error:
            updates["error_message"] = error
        if current_step:
            updates["current_step"] = current_step

        if generation:
            redis_db.update_generation(task_id, updates)
        else:
            updates["task_id"] = task_id
            redis_db.create_generation(updates)

    except Exception as e:
        print(f"Error updating task status: {e}")
        import traceback
        traceback.print_exc()


@celery_app.task(bind=True)
def generate_video_task(self, request_data: Dict[str, Any], generation_id: Optional[int] = None):
    """
    Celery task to generate video using video-composer.

    This task:
    1. Generates TTS audio from the script using OpenAI
    2. Transcribes the audio with word-level timestamps
    3. Fetches relevant stock footage based on keywords
    4. Validates footage with GPT-4 Vision
    5. Composes final video with karaoke-style subtitles
    """
    task_id = self.request.id
    script = request_data.get("script", "")

    # Get keywords - use provided ones or extract from script
    keywords = request_data.get("keywords", [])
    if not keywords:
        keywords = extract_keywords_from_script(script)

    # Voice settings
    voice = request_data.get("voice", "nova")
    voice_speed = request_data.get("voice_speed", 1.0)

    # Subtitle settings
    subtitles_enabled = request_data.get("subtitles_enabled", True)
    subtitle_font = request_data.get("subtitle_font", "Arial")
    subtitle_font_size = request_data.get("subtitle_font_size", 48)
    subtitle_primary_color = request_data.get("subtitle_primary_color", "#FFFFFF")
    subtitle_highlight_color = request_data.get("subtitle_highlight_color", "#FFFF00")
    subtitle_outline_color = request_data.get("subtitle_outline_color", "#000000")
    subtitle_outline_width = request_data.get("subtitle_outline_width", 3)
    subtitle_shadow_depth = request_data.get("subtitle_shadow_depth", 2)
    subtitle_position = request_data.get("subtitle_position", "bottom")
    subtitle_words_per_line = request_data.get("subtitle_words_per_line", 4)

    # Update status to STARTED
    update_task_status(task_id, "STARTED", progress=5, current_step="Initializing...")

    try:
        # Get settings from environment
        settings = get_settings()
        settings_any = cast(Any, settings)

        # Override settings with request values
        settings_any.tts_voice = voice
        settings_any.tts_speed = voice_speed

        if subtitles_enabled:
            settings_any.subtitle_font = subtitle_font
            settings_any.subtitle_font_size = subtitle_font_size
            settings_any.subtitle_primary_color = subtitle_primary_color
            settings_any.subtitle_highlight_color = subtitle_highlight_color
            settings_any.subtitle_outline_color = subtitle_outline_color
            settings_any.subtitle_outline_width = subtitle_outline_width
            settings_any.subtitle_shadow_depth = subtitle_shadow_depth
            settings_any.subtitle_position = subtitle_position
            settings_any.subtitle_words_per_line = subtitle_words_per_line

        # Ensure output directory exists
        output_dir = Path(os.getenv("OUTPUT_DIR", "./output"))
        output_dir.mkdir(parents=True, exist_ok=True)

        # Create the video composer
        composer = VideoComposer(settings)
        composer_any = cast(Any, composer)

        async def run_composer():
            async with composer:
                # Step 1: Generate TTS
                update_task_status(task_id, "STARTED", progress=10, current_step="Generating voiceover...")

                # Step 2: Transcribe (happens inside create_video)
                update_task_status(task_id, "STARTED", progress=25, current_step="Transcribing audio...")

                # Step 3: Fetch stock footage
                update_task_status(task_id, "STARTED", progress=40, current_step=f"Fetching stock footage for: {', '.join(keywords[:3])}...")

                # Step 4: Validate and compose
                update_task_status(task_id, "STARTED", progress=60, current_step="Validating footage...")

                result = await composer_any.create_video(
                    script=script,
                    keywords=keywords,
                    output_filename=f"video_{task_id}",
                    words_per_line=subtitle_words_per_line,
                    subtitles_enabled=subtitles_enabled,
                )

                update_task_status(task_id, "STARTED", progress=90, current_step="Finalizing video...")

                return result

        # Run async loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        result = loop.run_until_complete(run_composer())
        loop.close()

        if result.success:
            # Move output to shared directory if needed
            output_path = Path(result.output_path)
            if not str(output_path).startswith(str(output_dir)):
                final_path = output_dir / output_path.name
                if output_path.exists():
                    shutil.move(str(output_path), str(final_path))
                output_path = final_path

            # Construct URL to serve the file
            output_url = f"/static/{output_path.name}"
            update_task_status(
                task_id,
                "SUCCESS",
                progress=100,
                output_url=output_url,
                current_step="Complete!"
            )
            return {
                "status": "SUCCESS",
                "output_url": output_url,
                "output_path": str(output_path),
                "duration": result.duration,
            }
        else:
            error_msg = str(result.error) if result.error else "Unknown error during video generation"
            update_task_status(task_id, "FAILURE", error=error_msg, current_step="Failed")
            return {"status": "FAILURE", "error": error_msg}

    except Exception as e:
        error_msg = str(e)
        update_task_status(task_id, "FAILURE", error=error_msg, current_step="Failed")
        import traceback
        traceback.print_exc()
        return {"status": "FAILURE", "error": error_msg}
