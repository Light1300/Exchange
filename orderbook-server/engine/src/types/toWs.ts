export type TickerUpdatedMessage = {
    stream: string,
    data: {
        c?: string,
        h?: string,
        1?: string,
        v?: string,
        V?: string,
        s?: string,
        id: number,
        e: "ticker"
    }
}