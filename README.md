# Home Script 'Go2rtc'

This is a data source script for the home script worker

- Category: 'media'
- Ident:    'go2rtc'
- Provides: 'camera_webrtc'

The script enables WebRTC to use video streams from the go2rtc server:
https://github.com/AlexxIT/go2rtc

With go2rtc you can translate RTSP streams from webcams into WebRTC streams.

This script forwards the WebRTC signaling via the API from go2rtc into the video stream widget.\
The video-data itself is directly received in the UI, no need to handle that in the script.