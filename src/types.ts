export interface Connection {
    /** The websocket Identfier */
    socket_id: string;
    socket_connected: boolean;
    socket_url: string;
    /** Stream identifier from go2rtc */
    stream_id: string;
    /** Random ID from the frontend => indicates the video element */
    video_id: string;
    /** CleanUp after some maximum time */
    cleanup_timeout: NodeJS.Timeout;
    // The service answer, stored for later retrieval
    sdp_answer: string | undefined;
}