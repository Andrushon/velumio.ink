<p align="center">
  <a href="https://velumio.ink">
    <img src="https://img.shields.io/badge/Website-velumio.ink-0055ff?style=for-the-badge" alt="Website">
  </a>
  <img src="https://img.shields.io/badge/License-GPLv3-gold?style=for-the-badge" alt="GPLv3 License">
  <img src="https://img.shields.io/badge/Stage-Alpha-orange?style=for-the-badge" alt="Stage">
  <img src="https://img.shields.io/badge/Languages-38%20Supported-purple?style=for-the-badge" alt="Languages">
  <img src="https://img.shields.io/badge/AI-Real--Time%20STT-teal?style=for-the-badge" alt="Real-time STT">
</p>
---
# Velumio

**Velumio** is an open-source, AI-powered reading companion designed to enrich the experience of reading physical paper books. By listening to spoken words in real time, Velumio generates watercolor illustrations and adaptive ambient soundscapes, bridging the tactile charm of print with generative technology.

---

## Key Features

- **Real-Time Speech Tracking:** Low-latency Speech-to-Text (STT) that follows along as you read aloud.
- **Dynamic Watercolor Visuals:** Generates context-aware, evocative illustrations reflecting the narrative mood.
- **Ambient Soundscapes:** Produces subtle background audio and sound effects synchronized with key story moments.
- **Multilingual Support:** Architected to support up to 38 languages for diverse reading environments.
- **Privacy by Design:** Designed without permanent storage of voice recordings or intrusive telemetry.

---

## Architecture Overview

1. **Audio Capture & STT:** High-precision real-time voice streaming and transcription.
2. **Context Engine:** Extracts narrative beats, tone, and visual cues from the transcribed passage.
3. **Generative Pipeline:** Dispatches structured prompts to lightweight image and ambient audio generation layers.
4. **Client Interface:** Clean, distraction-free display optimized for tablets and ambient screens placed alongside physical books.

---

## Contributing

We welcome contributions from developers, designers, and educators. Please review our [CONTRIBUTING.md](./CONTRIBUTING.md) guide before submitting pull requests.

## License

This project is licensed under the [GNU General Public License v3.0 (GPLv3)](./LICENSE).
