# AI Interview Coach

A browser-based interview practice app with resume analysis, self-introduction practice, personal interview questions, stress interview questions, and session history.

## Run locally

```bash
npm install
npm run dev
```

Camera and microphone access requires `localhost` or HTTPS. Run `npm run build` to create the production build.

## Features and privacy

- Resume analysis supports PDF, DOCX, and TXT files up to 10 MB. Text extraction and ATS scoring run in the browser.
- Self-introduction and interview practice use the browser's speech-recognition API. Browser vendors may process speech through their own online recognition service; this app does not send audio to Gemini.
- Eye-contact feedback is an estimate based on MediaPipe face landmarks. The model and WASM runtime are downloaded from public CDNs; video frames are processed in the browser.
- Voice-confidence feedback is based on microphone loudness, pronunciation feedback uses speech-recognition confidence, and grammar feedback is a lightweight English-only rules check. They are estimates, not professional assessments. Tamil grammar scoring is unavailable.
- Completed session scores, transcripts, and answers are stored in this browser's local storage. Use **History → Clear history** to remove them.
- Gemini is not configured and no API key is required.
