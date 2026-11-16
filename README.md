# Sprout — Growth Timelapse Studio

A small, dependency-free browser app for turning dated garden and salad-growth photos into a time-lapse video.

## Use it

1. Open `index.html` in a recent version of Chrome, Edge, or Firefox.
2. Add photos by browsing or dragging them onto the upload area. JPEG EXIF capture dates are used when available; otherwise the file's modified date is used.
3. Edit each photo's date and time. The timeline and preview sort from oldest to newest automatically.
4. Use the preview arrows or **Play preview** to review the sequence. Set the overall video length in seconds, then adjust frame rate or video shape as desired.
5. Choose **Create my timelapse**. The app records the sequence in your browser and downloads a `.webm` video.

## Notes

- Photos are processed locally in your browser; they are not uploaded.
- The video export uses the browser's Canvas and MediaRecorder APIs. A recent browser with WebM recording support is recommended.
- The export is silent. Set the total video time directly; frames are shared as evenly as possible across the dated photos. The displayed duration is approximate to the nearest frame. The minimum export is one second and at least one frame per photo.
- Dates without timezone information in EXIF are interpreted in your local timezone.
- No installation, build step, external service, or server is required.

## License

This project is distributed under the MIT License. See [LICENSE](LICENSE) for the full text.
