export const SUBSCRIBE = "SUBSCRIBE";
export const UNSUBSCRIBE = "UNSUBSCRIBE";

export const type SubscribeMessage = {
    method: typeof SUBSCRIBE,
    params: string[],
} 

export const type UnsubscribeMessage = {
    method: typeof UNSUBSCRIBE,
    params: string[],
}  

export type IncomingMessage = SubscribeMessage | UnsubscribeMessage;