import { Script } from "@script_types/script/script";
import { ScriptConfig } from "../gen/spec_config";
import { Connection } from "./types";
import { ScriptCtxUI } from "@script_types/script/context_ui/context_ui";
import { ParameterType } from "@script_types/spec/spec_parameter";
import { SourceCameraWebRTC } from "@script_types/sources/media/source_camera_webrtc";
import { CtxWebsocket } from "@script_types/script/context_data/context_websocket";
import { sleep } from "./helper";

export class Instance {
    private ctx: Script.Context;
    private config: ScriptConfig;
    
    private connections: Connection[] = [];
    
    constructor(ctx: Script.Context, config: ScriptConfig) {
        this.ctx = ctx;
        this.config = config;
    }

    public start = async () => {

        const handleSubscriptionResult = (result: { error: string | undefined }) => {
            if (result.error) console.error(result.error);
        }
        this.ctx.ui.subscribeCommands<"camera_webrtc">("camera_webrtc", this.processCommandWebRTC).then(handleSubscriptionResult);

        this.ctx.ui.registerConfigOptionsProvider(this.configOptionsRequest);

        this.getProducers(); // initial fetch of producers

        console.log("Start done!");
    }

    public stop = async (_reason: Script.StopReason): Promise<void> => {
        console.info("Stopping all my stuff ...");
        this.connections.forEach(e => {
            clearTimeout(e.cleanup_timeout);
            this.ctx?.data.websocket.disconnect(e.socket_id);
        })
        this.connections = [];
    }

    public getProducers = async () => {
        if (this.config.server_url) {
            let url = this.config.server_url.value;
            if (!url.startsWith("http")) {
                url = `http://${url}`;
            }
            url = `${url}/api/streams`;
            console.debug("req streams: " + url);
            const res = await this.ctx.data.http.getJson(url);
            if (!res.error && res.statusCode == 200) {
                const data = <{[ident: string]: { producers: { url: string }[] | null }}> res.body;
                console.debug("found streams: ", data);
                return data;
            }  else {
                console.error("Getting streams failed: ", res.statusCode, res.error);
            }
        } else {
            console.warn("Getting streams: URL not configured!")
        }
        return undefined;
    }

    private configOptionsRequest: ScriptCtxUI.ConfigOptionsCallback = async (request) => {
        if (request.source == "widget") {
            if (request.parameter_ident == "stream_id") {
                const data = await this.getProducers();
                if (data) {
                    let dropdown_entries: ParameterType.DropdownEntry[] = [];
                    Object.keys(data).forEach(key => {
                        dropdown_entries.push({ value: key, name: key });
                    })
                    return { dropdown_entries };
                }
            } else {
                console.warn("Unknown parameter: ", request.parameter_ident);
            }
        }
        return undefined;
    };

    // ----------- The script funtionality --------------------


    private getWebsocketUrl = (stream_id: string): string | undefined => {
        const url_o = this.config?.server_url;
        if (url_o) {
            let url = url_o.value;
            if (!url.startsWith("ws://")) {
                url = "ws://" + url;
            }
            url += "/api/ws?src=" + stream_id;
            return url;
        }
        return undefined;
    }

    private getConnection = (id: string): Connection | undefined => {
       return this.connections.find(e => e.socket_id == id);
    }

    private socketStateChanged: CtxWebsocket.StateChangedCallback = (state) => {
        console.info("socketStateChanged: ", state);
        const conn = this.getConnection(state.uid);
        if (conn) {
            conn.socket_connected = state.connected;
            if (!state.connected) {
                // we do not need to keep a socket that was externally closed -> remove it!
                const i = this.connections.findIndex(e => e.socket_id == state.uid);
                if (i >= 0) {
                    const conn = this.connections[i];
                    clearTimeout(conn.cleanup_timeout);
                    this.connections.splice(i, 1);
                    this.ctx?.data.websocket.disconnect(conn.socket_id); // ensure that the underlying socket is closed
                }
            }
        }
    } 

    private socketDataReceived = (data: string, ws_id: string) => {
        try {
            const msg_o = JSON.parse(data);
            const type = msg_o.type;
            const value = msg_o.value;
            console.debug("dataRcv: ", ws_id, msg_o);
            if (type && value) {
                if (type == "webrtc/answer") {
                    const conn = this.getConnection(ws_id);
                    if (conn) {
                        conn.sdp_answer = value;
                        console.info(`dataRcv: connection '${ws_id}' => set sdp answer: `, value !== undefined);
                    } else {
                        console.warn(`dataRcv: connection '${ws_id}' not found`);
                    }
                } else if (type == "webrtc/candidate") {
                    const conn = this.getConnection(ws_id);
                    if (conn) {
                        const data: SourceCameraWebRTC.Data = {
                            msg: {
                                type: "ice_candidate",
                                encoding: "string",
                                candidate: value,
                                video_id: conn.video_id
                            }
                        }
                        this.ctx.ui.transmitData("camera_webrtc", data)
                    } else {
                        console.warn(`dataRcv: connection '${ws_id}' not found`);
                    }
                } else if (type == "mse") {
                    // example: {"type":"mse","value":"video/mp4; codecs=\"avc1.640029\""}
                    // Do nothing
                } else {
                    console.debug("dataRcv: unknown type: ", type, value);
                }
            } else {
                console.debug("dataRcv: unknown message: ", msg_o);
            }
        } catch (e) {
            console.error("dataRcv: error: ", e);
        }
    }

    private sendToSocket = async (socket_id: string, data: object) => {
        const conn = this.getConnection(socket_id);
        if (conn) {
            if (conn.socket_connected) {
                const res = await this.ctx?.data.websocket.sendData(socket_id, JSON.stringify(data));
                console.debug(`sendToSocket: Sending to '${socket_id}' result: `, res);
            } else {
                console.warn(`sendToSocket: '${socket_id}' not connected, data was: `, data);
            }
        } else {
            console.warn(`sendToSocket: '${socket_id}' not found`)
        }
    }

    public processCommandWebRTC: ScriptCtxUI.CommandCallback<"camera_webrtc"> = async (request, _env) => {
         console.debug("got command: ", request);
        if (request.type == "offer/request") {
            const stream_id = request.stream_ident;
            const ws_url = this.getWebsocketUrl(stream_id);
            if (ws_url !== undefined) {

                const i = this.connections.findIndex(e => e.socket_url == ws_url);
                if (i >= 0) {
                    console.warn("still connected, close first!")
                    const conn = this.connections[i];
                    clearTimeout(conn.cleanup_timeout);
                    this.connections.splice(i, 1);
                    await this.ctx?.data.websocket.disconnect(conn.socket_id);                   
                }

                const res = await this.ctx?.data.websocket.connect(ws_url, this.socketDataReceived, { 
                    auto_reconnect: true, 
                    state_handler: this.socketStateChanged
                });
                if (res && res.uid) {
                    const socket_id = res.uid;
                    const video_id = request.video_id;
                    const connected = await this.ctx?.data.websocket.isConnected(socket_id);
                    console.log("Websocket created: ", ws_url, socket_id);
                    const conn: Connection = {
                        socket_id,
                        stream_id,
                        video_id,
                        socket_url: ws_url,
                        socket_connected: connected !== undefined ? connected : false,
                        sdp_answer: undefined,
                        cleanup_timeout: setTimeout(() => {
                            console.error("timeout for socket: ", stream_id, socket_id, video_id);
                            const i = this.connections.findIndex(e => e.socket_id == socket_id);
                            if (i >= 0) {
                                this.ctx?.data.websocket.disconnect(socket_id);
                                if (i > 0) {
                                    this.connections.splice(i, 1);
                                }
                            }
                        },  10 * 60 * 1000)
                    };
                    this.connections.push(conn);
                    await sleep(50);

                    // Send the offer to the client:
                    await this.sendToSocket(socket_id, {
                        type: "webrtc/offer",
                        value: request.client_sdp,
                    })

                    const t_start = Date.now();
                    while ((Date.now() - t_start) < 3000 && !conn.sdp_answer) {
                        await sleep(10);
                    }
                    
                    if (!conn.sdp_answer) {
                        console.warn("Could not get offer for ", socket_id, video_id);
                        const i = this.connections.findIndex(e => e.socket_id == socket_id);
                        if (i >= 0) {
                            const conn = this.connections[i]; 
                            this.connections.splice(i, 1);
                            clearTimeout(conn.cleanup_timeout);
                            this.ctx?.data.websocket.disconnect(socket_id);
                        }
                        return {
                            type: "error/response",
                            error: "Timeout: did not received offering"
                        }
                    } else {
                        const elapsed = Date.now() - t_start;
                        console.log(`Got offer for '${socket_id}'/'${video_id}' after ${elapsed} ms: `, conn.sdp_answer);
                        return {
                            type: "offer/response",
                            encoding: "string",
                            server_sdp: conn.sdp_answer
                        }
                    }
                } else {
                    console.error("Websocket open did not work: ", res?.error);
                    return {
                        type: "error/response",
                        error: "Connecting to server failed"
                    }
                }
            }
        } else if (request.type == "close/request") {
            const stream_id = request.stream_ident;
            const video_id = request.video_id;
            const i = this.connections.findIndex(e => e.video_id == video_id);
            if (i >= 0) {
                const conn = this.connections[i];
                clearTimeout(conn.cleanup_timeout);
                this.connections.splice(i, 1);
                await this.ctx?.data.websocket.disconnect(conn.socket_id);
                
            } else {
                console.debug(`close/request => could not find video '${video_id}' for stream '${stream_id}', might be already closed`);
            }
        }
        return undefined;
    }
}