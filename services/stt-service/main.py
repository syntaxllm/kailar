import os
import time
from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, BackgroundTasks, Form
from pydantic import BaseModel
import torch
from faster_whisper import WhisperModel
# from pyannote.audio import Pipeline # Will need token
import uuid

app = FastAPI(title="MeetingAI STT Service")

# Load Whisper Model
# Using 'base' or 'small' for dev to be fast
device = "cuda" if torch.cuda.is_available() else "cpu"
model_size = os.getenv("WHISPER_MODEL_SIZE", "base")
model = WhisperModel(model_size, device=device, compute_type="float32")

class TranscriptEntry(BaseModel):
    start_time: float
    end_time: float
    speaker_id: str
    text: str

class TranscriptionResponse(BaseModel):
    meeting_id: str
    status: str
    transcript: List[TranscriptEntry]
    duration: float

@app.get("/health")
def health():
    return {"status": "ok", "device": device, "model": model_size}

@app.post("/transcribe", response_model=TranscriptionResponse)
async def transcribe(
    file: UploadFile = File(...), 
    meeting_id: Optional[str] = Form(None),
    speaker_names: Optional[str] = Form(None)
):
    if not meeting_id:
        meeting_id = str(uuid.uuid4())
    
    # Parse real speaker names if provided
    real_speakers = []
    if speaker_names:
        try:
            import json
            real_speakers = json.loads(speaker_names)
        except:
            pass

    start_ts = time.time()
    
    # Save file temporarily
    temp_path = f"temp_{meeting_id}.wav"
    with open(temp_path, "wb") as f:
        f.write(await file.read())
    
    try:
        # 1. Transcribe with faster-whisper + Silero VAD
        segments, info = model.transcribe(
            temp_path, 
            beam_size=5, 
            vad_filter=True, 
            vad_parameters=dict(min_silence_duration_ms=500)
        )
        
        transcript = []
        for segment in segments:
            # Map segment timestamp to the closest real speaker name from the log
            speaker_id = "SPEAKER_00"
            if real_speakers:
                # Find speaker active at this segment's start time
                # log: [{name, timestamp}, ...]
                current_speaker = "Unknown"
                for entry in real_speakers:
                    if entry['timestamp'] <= segment.start:
                        current_speaker = entry['name']
                    else:
                        break
                speaker_id = current_speaker

            transcript.append(TranscriptEntry(
                start_time=segment.start,
                end_time=segment.end,
                speaker_id=speaker_id, 
                text=segment.text.strip()
            ))
            
        # 2. Add Diarization logic here later (pyannote.audio)
        # Note: For now, we remain compatible with the schema
        
        end_ts = time.time()
        
        return TranscriptionResponse(
            meeting_id=meeting_id,
            status="completed",
            transcript=transcript,
            duration=end_ts - start_ts
        )
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=4545)
