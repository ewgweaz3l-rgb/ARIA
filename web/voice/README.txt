ARIA VOICE PACK
===============

Put pre-rendered voice clips here (.wav, .mp3, .ogg, .m4a or .flac).
ARIA plays a clip instead of the browser voice whenever one matches.

How to make them:
1. Voice Macros room -> "Export voice lines". You get aria-voice-lines.csv with
   every line ARIA says and the exact file name each clip needs.
2. Render each line in ComfyUI (or any TTS) with your cloned voice.
3. Save each clip here under the file name from the CSV, e.g.
      hailing-station.wav       ->  "Hailing station."
      course-plotted.wav        ->  "Course plotted."
4. Hit the refresh button in ARIA. The Voice Macros room shows how many clips it found.

A macro reply's file name is just the reply text in lower case with dashes,
so if you add a new macro reply, export again to get its file name.

Lines with live numbers or names in them (trade hauls, distances) can't be
pre-rendered. Set "Replies" to "Voice pack only" and ARIA plays the short
generic clip for those (haul-found.wav, course-plotted.wav) instead.
