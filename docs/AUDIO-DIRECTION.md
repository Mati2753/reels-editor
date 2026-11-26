# Sound direction and approved edits

The browser and the native reference analyzer decode a 16 kHz mono listening track. YAMNet estimates 521 AudioSet classes over windows of up to 975 ms with a 480 ms step. The evidence export includes timestamps, speech, music, silence and up to four acoustic tags with scores. These are estimates from the mixed waveform. A tag cannot establish whether a sound was recorded on set or added later. The model cannot isolate the original stems.

The director checks the material kept in the timeline. Sustained music with sufficient measured coverage suppresses the additional music bed. Strong instrumental evidence can also skip an unnecessary transcription. On spoken clips, the browser compares the rendered audio with the corresponding source windows inside each shot. Repeated loss of speech evidence alongside increased music evidence triggers a local reduction in added music and effects. The next pass measures the export again subject to the selected iteration limit. This checks one cause of masking. Word recognition, perceived intelligibility and taste still need listening review.

Under feedback, keeping the camera, caption treatment or sound mix saves the relevant settings for the same style family and speech context. The browser stores up to three explicitly approved source/edit examples on the current device when space permits. Open **Approved examples** to compare the footage, replay the finished cut or remove a pair.

## Rendered validation

The browser learned a profile from the narrated Alpine Field Notes sample. Of 24 windows, 18 contained strong speech evidence. All 13 windows in a second musical clip contained strong music evidence. The exported file contains H.264 picture and AAC audio, lasts 6.467 seconds and has no additional music bed in the timeline. In a local Chromium run, learning the reference took approximately 13 seconds and completing this edit took another 16 seconds. After reload both the original and the approved MP4 decoded, and a new edit retrieved the approved mix.

A stress test deliberately raised an added bed to +20 dB. The first render flagged two speech-masking intervals and 36 technical issues. The revised render flagged one interval and nine technical issues. It still needed review. The stored report gives the timestamps and measured scores for both renders.

[Input clip](../examples/audio-direction/footage-with-music.mp4) · [Rendered edit](../examples/audio-direction/finished.mp4) · [Measured results](../examples/audio-direction/measurements.json) · [Browser replay test](../scripts/check-browser-sound.py)

## Compatibility and provenance

The local CPU path uses ONNX Runtime WASM. The browser downloads the pinned model from the editor's own host and runs prediction on device. The native reference analyzer verifies the model checksum before creating the session. The 16,093,603-byte ONNX conversion uses Google YAMNet weights and the AudioSet ontology under Apache-2.0. The license and ordered labels ship alongside the model. Model revision and checksum are in the sound evidence module. [Upstream YAMNet](https://github.com/tensorflow/models/tree/master/research/audioset/yamnet) · [Pinned ONNX conversion](https://huggingface.co/zeropointnine/yamnet-onnx/tree/ac2ca3bd45d12ec1f19f1144205ea529b4e9dedf)
