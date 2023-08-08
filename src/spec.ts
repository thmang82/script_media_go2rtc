import { DataSource } from '../../toolchain/types/spec/spec_source';

export const specification: DataSource.Specification = {
    category:  "media",
    id_ident:  "go2rtc",
    id_author: "thmang82",
    // ---
    provides: [ "camera_webrtc" ] as const,
    // ---
    version:   "0.8.1",
    // ---
    translations: {
        'en' : { 
            name: "WebRTC from go2rtc",
            description: "WebRTC from go2rtc"
        }
    },
    // ---
    parameters: [
        {
            type: "TextField",
            ident: "server_url",
            translations: {
                "en": {
                    name: "The Server Url",
                    description: "Only provide the go2rtc host with the API port. Everything else is handled internally"
                }
            },
            validate: [ /^[A-Za-z\d\._-]+:\d+$/ ],
            value_default: undefined,
            value_example: "server:1984",
            value_type: "string"
        }
    ],
    notifications: [],
    geo_relevance: { 
        everywhere: true
    },
    data_fetch: undefined // No data fetch needed for camera_webrtc source, we get a command instead
};